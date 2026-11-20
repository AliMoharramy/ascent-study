import { z } from "zod";
import { api, body } from "@/server/http";
import { listDecisions, listDocs, readDoc, recordDecision, searchDocs, setDecisionStatus } from "@/server/codex";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, req }) => {
  const u = new URL(req.url).searchParams;
  const q = u.get("q") ?? "";
  const doc = u.get("doc");
  return { docs: listDocs(), doc: doc ? readDoc(doc) : null, hits: q ? searchDocs(q) : [], decisions: (await listDecisions(db, userId, q || undefined)) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decision"), title: z.string(), body: z.string().optional(), rationale: z.string(), alternatives: z.string().optional(), status: z.enum(["proposed", "accepted", "superseded", "rejected"]).optional() }),
  z.object({ action: z.literal("status"), id: z.string().max(40), status: z.enum(["proposed", "accepted", "superseded", "rejected"]) }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  if (b.action === "status") (await setDecisionStatus(db, userId, b.id, b.status));
  else {
    const { action: _a, ...d } = b;
    (await recordDecision(db, userId, d, gameDay(new Date(), session.user.timezone, session.user.rolloverHour)));
  }
  return { decisions: (await listDecisions(db, userId)) };
});
