import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { authSessions, configVersions, users } from "@/db/schema";
import { createUser, getSessionUser, login, logout, setPassword, setupUser, SetupAlreadyCompleted } from "./auth";

let fixture: TestDb;
afterEach(async () => { await fixture?.close(); });
const input = { username: "Ascender", name: "Ascender", password: "local test password" };

describe("PostgreSQL setup and authentication", () => {
  it("makes singleton setup and initial config atomic under concurrent requests", async () => {
    fixture = await createTestDb({ label: "auth" });
    const db = fixture.db;
    const results = await Promise.allSettled([setupUser(db, input), setupUser(db, { ...input, username: "other" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(SetupAlreadyCompleted);
    const user = (await db.select().from(users))[0]!;
    expect(await db.select().from(configVersions)).toMatchObject([{ userId: user.id, version: 1 }]);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("does not leave a user when initial config insertion fails", async () => {
    fixture = await createTestDb({ label: "setup" });
    const db = fixture.db;
    await db.execute(sql`ALTER TABLE config_versions ADD CONSTRAINT reject_config CHECK (version < 0)`);
    await expect(setupUser(db, input)).rejects.toThrow();
    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(configVersions)).toEqual([]);
  });

  it("counts concurrent bad logins without lost increments and expires the lock", async () => {
    fixture = await createTestDb({ label: "login" });
    const db = fixture.db;
    await createUser(db, input);
    const now = new Date("2026-11-14T10:00:00Z");
    const results = await Promise.all(Array.from({ length: 5 }, () => login(db, input.username, "wrong", undefined, now)));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await login(db, input.username, input.password, undefined, now)).toMatchObject({ ok: false, reason: "locked", lockedUntil: "2026-11-14T10:15:00.000Z" });
    expect(await db.select().from(authSessions)).toEqual([]);
    expect(await login(db, input.username, input.password, undefined, new Date("2026-11-14T10:16:00Z"))).toMatchObject({ ok: true });
  });

  it("revokes sessions atomically with password changes and preserves ISO expiry", async () => {
    fixture = await createTestDb({ label: "session" });
    const db = fixture.db;
    const id = await createUser(db, input);
    const now = new Date("2026-11-14T10:00:00Z");
    const result = await login(db, "ascender", input.password, undefined, now);
    if (!result.ok) throw new Error("Expected login success");
    expect((await getSessionUser(db, result.token, now))?.user.id).toBe(id);
    expect(await getSessionUser(db, result.token, new Date("2026-12-14T10:00:00Z"))).toBeNull();
    await setPassword(db, id, "new local test password");
    expect(await getSessionUser(db, result.token, now)).toBeNull();
    expect(await login(db, "ascender", input.password, undefined, now)).toEqual({ ok: false, reason: "invalid" });
    const next = await login(db, "ascender", "new local test password", undefined, now);
    if (!next.ok) throw new Error("Expected new password login success");
    await logout(db, next.token);
    expect(await getSessionUser(db, next.token, now)).toBeNull();
  });
});
