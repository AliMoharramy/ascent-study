import { z } from "zod";
import { api, body } from "@/server/http";
import { acceptShaping, habitStats, logHabit, saveHabit, saveScorecard, scorecard, setHabitStatus, shapingView } from "@/server/habits";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => ({ habits: (await habitStats(db, userId, day(session))), scorecard: (await scorecard(db, userId)), shaping: (await shapingView(db, userId, day(session))) }));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().max(40).optional(), habit: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("status"), id: z.string().max(40), status: z.enum(["proposed", "trial", "active", "mastered", "archived"]) }),
  z.object({ action: z.literal("log"), id: z.string().max(40), tier: z.enum(["seed", "standard", "stretch"]).nullable(), day: z.string().optional(), value: z.number().nullish() }),
  z.object({ action: z.literal("scorecard"), items: z.array(z.unknown()) }),
  z.object({ action: z.literal("shaping_accept"), id: z.string().max(40) }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "save") return { id: (await saveHabit(db, userId, b.habit as never, d, b.id)) };
  if (b.action === "status") (await setHabitStatus(db, userId, b.id, b.status, d));
  if (b.action === "log") {
    (await logHabit(db, userId, b.id, b.day ?? d, b.tier, b.value));
    return (await afterLog(db, userId, b.day ?? d));
  }
  if (b.action === "scorecard") return { scorecard: (await saveScorecard(db, userId, b.items)) };
  if (b.action === "shaping_accept") return { shaping: (await acceptShaping(db, userId, b.id, d)) };
  return { ok: true };
});
