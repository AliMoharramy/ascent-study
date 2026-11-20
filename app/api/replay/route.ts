import { api } from "@/server/http";
import { ledgerSnapshot, replayAll } from "@/events/projections";
import { appendEvent } from "@/events/store";

/** Replay tool (F-CORE-10): rebuilds ledgers from the event log and reports whether anything changed. */
export const POST = api(async ({ db, userId }) => {
  const before = (await ledgerSnapshot(db, userId));
  const r = (await replayAll(db, userId));
  const after = (await ledgerSnapshot(db, userId));
  const same = before.length === after.length && before.every((x, i) => x === after[i]);
  (await appendEvent(db, { userId, type: "projection.replayed", payload: { ...r, identical: same }, source: "system" }));
  return { ...r, identical: same, rows: after.length };
});
