// npm run replay [-- username] — rebuild XP/Score/Gold ledgers from the event log and diff them.
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { ledgerSnapshot, replayAll } from "../src/events/projections";
import { appendEvent } from "../src/events/store";

const db = getDb();
try {
  const who = process.argv[2];
  const list = who ? await db.select().from(users).where(eq(users.username, who.toLowerCase())) : await db.select().from(users);
  if (list.length === 0) {
    console.error(who ? `No user named "${who}".` : "No users in this database.");
    process.exitCode = 1;
  }
  for (const u of list) {
    const before = await ledgerSnapshot(db, u.id);
    const r = await replayAll(db, u.id);
    const after = await ledgerSnapshot(db, u.id);
    const identical = before.length === after.length && before.every((x, i) => x === after[i]);
    await appendEvent(db, { userId: u.id, type: "projection.replayed", payload: { ...r, identical }, source: "system" });
    console.log(`${u.username}: ${r.days} days, ${after.length} ledger rows — ${identical ? "identical" : `DIFF ${before.length} → ${after.length}`}`);
    if (!identical) {
      const removed = before.filter((x) => !after.includes(x)).slice(0, 5);
      const added = after.filter((x) => !before.includes(x)).slice(0, 5);
      if (removed.length) console.log(`  removed: ${removed.join(" | ")}`);
      if (added.length) console.log(`  added:   ${added.join(" | ")}`);
    }
  }
} finally {
  await closeDb();
}
