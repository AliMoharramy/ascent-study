import { z } from "zod";
import { api, body } from "@/server/http";
import { answerReview, createCard, dueCards, saveArtifact } from "@/server/forge";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => ({ due: (await dueCards(db, userId, day(session))) }));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), cardId: z.string().max(40), answer: z.enum(["again", "hard", "good"]) }),
  z.object({ action: z.literal("card"), front: z.string(), back: z.string(), chapterId: z.string().nullish() }),
  z.object({ action: z.literal("artifact"), id: z.string().max(40).optional(), title: z.string(), bodyMd: z.string(), chapterId: z.string().nullish(), kind: z.enum(["sheet", "lesson", "summary", "formula"]).optional() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "answer") (await answerReview(db, userId, b.cardId, b.answer, d));
  if (b.action === "card") (await createCard(db, userId, b, d));
  if (b.action === "artifact") (await saveArtifact(db, userId, b, d, b.id));
  return { due: (await dueCards(db, userId, d)).length, ...(await afterLog(db, userId, d)) };
});
