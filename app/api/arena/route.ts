import { z } from "zod";
import { api, body } from "@/server/http";
import { bossShareView, listBosses, listMocks, logBossResult, logMock, nextBoss, rivalView, settleDuels, skipBoss } from "@/server/arena";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session, req }) => {
  const share = new URL(req.url).searchParams.get("share");
  if (share) return (await bossShareView(db, userId, share));
  const d = day(session);
  (await settleDuels(db, userId, d));
  return { rival: (await rivalView(db, userId, d)), bosses: (await listBosses(db, userId)), next: (await nextBoss(db, userId, d)), mocks: (await listMocks(db, userId)) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("boss_result"), bossId: z.string().max(40), results: z.array(z.unknown()) }),
  z.object({ action: z.literal("boss_skip"), bossId: z.string().max(40) }),
  z.object({
    action: z.literal("mock"),
    mockNo: z.number(),
    perSubject: z.record(z.string(), z.unknown()),
    rank: z.number().nullish(),
    suspects: z.number().int().min(0).max(1000).nullish(),
    elapsedSec: z.number().int().min(0).max(24 * 3600).nullish(),
    mode: z.enum(["quick", "exam"]).optional(),
  }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  let r: unknown = null;
  if (b.action === "boss_result") r = (await logBossResult(db, userId, b.bossId, { results: b.results as never }, d));
  if (b.action === "boss_skip") (await skipBoss(db, userId, b.bossId, d));
  if (b.action === "mock") r = (await logMock(db, userId, b as never, d));
  return { result: r, bossDefeated: b.action === "boss_result" && !!(r as { defeated?: boolean } | null)?.defeated, ...(await afterLog(db, userId, d)) };
});
