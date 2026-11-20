import { z } from "zod";
import { api, body } from "@/server/http";
import { coreDone, detourLedger, listIdeas, logDetour, parkIdea, updateIdea } from "@/server/ideas";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => ({ ideas: (await listIdeas(db, userId)), coreDone: (await coreDone(db, userId, day(session))), ledger: (await detourLedger(db, userId, day(session))) }));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("park"), text: z.string(), tags: z.string().optional(), value: z.number().nullish(), effort: z.enum(["S", "M", "L"]).nullish(), whyNow: z.string().nullish() }),
  z.object({ action: z.literal("update"), id: z.string().max(40), status: z.enum(["parked", "chosen", "built", "dropped"]).optional(), value: z.number().optional(), effort: z.enum(["S", "M", "L"]).optional() }),
  z.object({ action: z.literal("detour"), kind: z.string(), choice: z.enum(["study_first", "later", "continue"]), minutes: z.number().optional(), reason: z.string().nullish() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  if (b.action === "park") return { id: (await parkIdea(db, userId, b)) };
  if (b.action === "update") {
    const { id, action: _a, ...patch } = b;
    (await updateIdea(db, userId, id, patch));
    return { ok: true };
  }
  const { action: _a, ...d } = b;
  return { id: (await logDetour(db, userId, d as never, day(session))) };
});
