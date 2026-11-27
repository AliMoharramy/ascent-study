import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTestDb, type TestDb } from "@/db/testing";
import { aiBudgetReservations, aiCalls, events } from "@/db/schema";
import { createUser } from "./auth";
import { ensureDefaultConfig, updateConfig } from "./config";
import { aiStatus, remoteCall } from "./ai";
import { submitStudyLog } from "./studyLogs";

let fixture: TestDb;
let userId: string;
const today = "2026-11-14";
const sensitiveSource = "PRIVATE_SOURCE_MARKER: breadth-first search uses a queue.";
const decision = {
  decision: "schedule",
  reason: "The supplied notes support four source-grounded prompts.",
  reviews: [
    {
      front: "PRIVATE_SOURCE_MARKER: breadth-first search uses a {{blank}}.",
      back: "queue",
      evidence: "PRIVATE_SOURCE_MARKER: breadth-first search uses a queue.",
    },
    {
      front: "breadth-first search uses a {{blank}}.",
      back: "queue",
      evidence: "breadth-first search uses a queue.",
    },
    {
      front: "breadth-first search uses a {{blank}}.",
      back: "queue",
      evidence: "breadth-first search uses a queue.",
    },
    {
      front: "breadth-first search uses a {{blank}}.",
      back: "queue",
      evidence: "breadth-first search uses a queue.",
    },
  ],
};

function providerResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1230, completion_tokens: 450 },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

async function enableRemoteAi(patch: Record<string, unknown> = {}) {
  await ensureDefaultConfig(fixture.db, userId);
  await updateConfig(
    fixture.db,
    userId,
    {
      flags: { ai: true },
      ai: { baseUrl: "https://ai.test/v1", ...patch },
    },
    "enable AI adapter tests",
  );
  vi.stubEnv("AI_KEY", "test-provider-key");
  vi.stubEnv("AI_MODEL", "study-log-test-model");
}

beforeEach(async () => {
  fixture = await createTestDb({ label: "study-ai" });
  userId = await createUser(fixture.db, {
    username: "study-ai-owner",
    name: "AI owner",
    password: "local test password",
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
});

describe("study-log AI adapter privacy and budget admission", () => {
  it("persists usage metadata but redacts successful source-derived provider output", async () => {
    await enableRemoteAi();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse(JSON.stringify(decision)));

    const result = await submitStudyLog(
      fixture.db,
      userId,
      {
        topic: "Breadth-first search",
        sourceText: sensitiveSource,
        clientRequestId: "study-ai-private-001",
        consentToRemoteAi: true,
      },
      today,
    );

    expect(result.log.status).toBe("scheduled");
    const logs = await fixture.db.select().from(aiCalls).where(eq(aiCalls.userId, userId));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: "remote",
      purpose: "study_log_review_planning",
      tokensIn: 1230,
      tokensOut: 450,
    });
    expect(logs[0]!.costEst).toBeGreaterThan(0);
    expect(logs[0]!.requestSummary).toBe("study_log_review_planning: redacted");
    expect(logs[0]!.responseJson).toBe(JSON.stringify({ status: "succeeded" }));
    expect(JSON.stringify(logs)).not.toContain("PRIVATE_SOURCE_MARKER");
    const audit = await fixture.db.select().from(events).where(eq(events.userId, userId));
    expect(JSON.stringify(audit)).not.toContain("PRIVATE_SOURCE_MARKER");
    expect(
      await fixture.db.select().from(aiBudgetReservations).where(eq(aiBudgetReservations.userId, userId)),
    ).toMatchObject([{ status: "settled", settledCost: expect.any(Number) }]);
  });

  it("does not record rejected provider content or raw provider errors in AI telemetry or audit events", async () => {
    await enableRemoteAi();
    const rejected = {
      ...decision,
      reviews: decision.reviews.map((review) => ({
        ...review,
        evidence: "REJECTED_RESPONSE_MARKER not in source",
      })),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse(JSON.stringify(rejected)));

    const result = await submitStudyLog(
      fixture.db,
      userId,
      {
        topic: "Breadth-first search",
        sourceText: sensitiveSource,
        clientRequestId: "study-ai-rejected-001",
        consentToRemoteAi: true,
      },
      today,
    );

    expect(result.log.status).toBe("retryable");
    const records = await fixture.db.select().from(aiCalls).where(eq(aiCalls.userId, userId));
    expect(records[0]!.responseJson).toBe(JSON.stringify({ status: "succeeded" }));
    const audit = await fixture.db.select().from(events).where(eq(events.userId, userId));
    expect(JSON.stringify([...records, ...audit])).not.toContain("REJECTED_RESPONSE_MARKER");
    expect(JSON.stringify([...records, ...audit])).not.toContain("PRIVATE_SOURCE_MARKER");
  });

  it.each([
    ["request cap", { maxCallsPerDay: 1 }],
    ["cost cap", { maxCallsPerDay: 20, monthlyCostCapUsd: 0.0005 }],
  ] as const)(
    "atomically admits only one concurrent request competing for the last %s",
    async (_label, caps) => {
      await enableRemoteAi(caps);
      let calls = 0;
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requestEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          entered();
          await blocked;
        }
        return providerResponse(JSON.stringify({ ok: true }));
      });
      const schema = z.object({ ok: z.boolean() });
      const first = remoteCall(
        fixture.db,
        userId,
        "budget_test",
        "small system",
        "small request",
        schema,
        today,
      );
      await requestEntered;
      const second = await remoteCall(
        fixture.db,
        userId,
        "budget_test",
        "small system",
        "small request",
        schema,
        today,
      );
      release();
      const firstResult = await first;

      expect(firstResult?.value).toEqual({ ok: true });
      expect(second).toBeNull();
      expect(calls).toBe(1);
    },
  );

  it("sanitizes provider error details while conservatively retaining the failed reservation", async () => {
    await enableRemoteAi();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("PROVIDER_ERROR_SECRET", { status: 503 }));
    const result = await remoteCall(
      fixture.db,
      userId,
      "study_log_review_planning",
      "system",
      "source excerpt",
      z.object({ ok: z.boolean() }),
      today,
    );

    expect(result).toBeNull();
    const logs = await fixture.db.select().from(aiCalls).where(eq(aiCalls.userId, userId));
    expect(JSON.stringify(logs)).not.toContain("PROVIDER_ERROR_SECRET");
    expect(logs[0]!.responseJson).toBe(JSON.stringify({ status: "failed", code: "provider_http_error" }));
    const reservations = await fixture.db
      .select()
      .from(aiBudgetReservations)
      .where(eq(aiBudgetReservations.userId, userId));
    expect(reservations[0]).toMatchObject({ status: "uncertain", reservedCost: expect.any(Number) });
  });

  it("recovers stale reservations conservatively and accounts by game-day and game-day month", async () => {
    await enableRemoteAi();
    const at = new Date().toISOString();
    await fixture.db.insert(aiBudgetReservations).values({
      id: "stale-ai-reservation-001",
      userId,
      requestId: "stale-ai-request-001",
      purpose: "budget_test",
      gameDay: today,
      budgetMonth: today.slice(0, 7),
      reservedCost: 0.0004,
      settledCost: 0,
      status: "reserved",
      expiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: at,
      updatedAt: at,
    });

    const sameDay = await aiStatus(fixture.db, userId, today);
    expect(sameDay).toMatchObject({ callsToday: 1, monthCost: 0.0004 });
    expect(
      (
        await fixture.db
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.id, "stale-ai-reservation-001"))
      )[0]!.status,
    ).toBe("uncertain");
    expect((await aiStatus(fixture.db, userId, "2026-11-15")).callsToday).toBe(0);
    expect((await aiStatus(fixture.db, userId, "2026-11-15")).monthCost).toBe(0.0004);
    expect((await aiStatus(fixture.db, userId, "2026-12-01")).monthCost).toBe(0);
  });
});
