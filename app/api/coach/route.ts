import { z } from "zod";
import { api, body } from "@/server/http";
import { approveProposal, coachView, rejectProposal, sendCoachMessage } from "@/server/coach";
import { gameDay } from "@/lib/time";

export const maxDuration = 60;

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await coachView(db, userId, day(session))));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), text: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("approve"), proposalId: z.string().min(1).max(60) }),
  z.object({ action: z.literal("reject"), proposalId: z.string().min(1).max(60) }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "message") return (await sendCoachMessage(db, userId, b.text, d, session.user.timezone));
  if (b.action === "approve") return (await approveProposal(db, userId, b.proposalId, d));
  return (await rejectProposal(db, userId, b.proposalId, d));
});
