import { z } from "zod";
import { api, body } from "@/server/http";
import { completeOnboarding, confirmBaseline, councilData, getNightly, goalView, monthlyInput, monthlyReviewView, reviewRoundsView, saveCouncil, saveMonthly, saveNightly, setGoal, setReviewRound } from "@/server/reviews";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session, req }) => {
  const kind = new URL(req.url).searchParams.get("kind");
  const d = day(session);
  if (kind === "council") return (await councilData(db, userId, d));
  if (kind === "goal") return (await goalView(db, userId, d));
  if (kind === "rounds") return (await reviewRoundsView(db, userId, d));
  if (kind === "monthly") return (await monthlyReviewView(db, userId, d));
  return (await getNightly(db, userId, d));
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("nightly"), spark: z.string().optional(), envDone: z.array(z.string()).optional(), checklist: z.array(z.string()).optional(), seconds: z.number().optional() }),
  z.object({ action: z.literal("council"), worked: z.string().optional(), blocked: z.string().optional(), oneChange: z.string(), slotTopic: z.string().optional(), planApproved: z.boolean().optional(), bossNote: z.string().optional() }),
  z.object({ action: z.literal("goal"), minutes: z.number(), tier: z.enum(["seed", "standard", "stretch"]).optional() }),
  z.object({ action: z.literal("baseline") }),
  z.object({ action: z.literal("onboarding") }),
  z.object({ action: z.literal("round"), id: z.string().max(40), status: z.enum(["pending", "done", "skipped"]), note: z.string().max(500).optional(), scheduledOn: z.string().max(10).optional() }),
  monthlyInput.extend({ action: z.literal("monthly") }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  const { action, ...rest } = b;
  if (action === "nightly") (await saveNightly(db, userId, d, rest as never));
  if (action === "council") return { saved: (await saveCouncil(db, userId, d, rest as never)) };
  if (action === "goal") return { goal: (await setGoal(db, userId, d, rest as never)), view: (await goalView(db, userId, d)) };
  if (action === "baseline") {
    const r = (await confirmBaseline(db, userId, d));
    return { tiers: r.triage.results.length, planItems: r.plan.items.length };
  }
  if (action === "onboarding") (await completeOnboarding(db, userId, d));
  if (b.action === "round") return { saved: (await setReviewRound(db, userId, b.id, b.status, d, b.note ?? "", b.scheduledOn)) };
  if (b.action === "monthly") return { saved: (await saveMonthly(db, userId, d, b)) };
  return (await afterLog(db, userId, d));
});
