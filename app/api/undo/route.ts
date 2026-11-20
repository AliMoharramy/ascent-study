import { z } from "zod";
import { api, body } from "@/server/http";
import { undoable, undoEvent } from "@/server/undo";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId }) => ({ items: (await undoable(db, userId)) }));

export const POST = api(async ({ db, userId, req, session }) => {
  const { eventId } = z.object({ eventId: z.string().max(40) }).parse(await body(req));
  const e = (await undoEvent(db, userId, eventId));
  return { undone: e.type, ...(await afterLog(db, userId, gameDay(new Date(), session.user.timezone, session.user.rolloverHour))) };
});
