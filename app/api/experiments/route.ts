import { z } from "zod";
import { api, body } from "@/server/http";
import { cancelExperiment, experimentInput, experimentsView, finishExperiment, startExperiment } from "@/server/experiments";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await experimentsView(db, userId, day(session))));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), changeText: experimentInput.shape.changeText, metric: experimentInput.shape.metric }),
  z.object({ action: z.literal("finish"), id: z.string().min(1).max(60) }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(60) }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "start") return (await startExperiment(db, userId, { changeText: b.changeText, metric: b.metric }, d));
  if (b.action === "finish") return (await finishExperiment(db, userId, b.id, d));
  return (await cancelExperiment(db, userId, b.id, d));
});