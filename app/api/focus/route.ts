import { z } from "zod";
import { api, body } from "@/server/http";
import { idlePause, discardFocus, minutesForDay, openSession, pauseFocus, resumeFocus, startFocus, stopFocus, view } from "@/server/focus";
import { gameDay } from "@/lib/time";
import { afterLog } from "@/server/after";

export const GET = api(async ({ db, userId, session }) => {
  const open = (await openSession(db, userId));
  const day = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return { session: open ? view(open) : null, todayMinutes: (await minutesForDay(db, userId, day)), serverNow: new Date().toISOString() };
});

const action = z.object({ action: z.enum(["start", "pause", "resume", "stop", "discard", "idle"]) }).passthrough();

export const POST = api(async ({ db, userId, req, session }) => {
  const b = action.parse(await body(req));
  const opts = { tz: session.user.timezone, rolloverHour: session.user.rolloverHour };
  let row;
  switch (b.action) {
    case "start":
      row = (await startFocus(db, userId, b as Record<string, unknown>, opts));
      break;
    case "pause":
      row = (await pauseFocus(db, userId));
      break;
    case "resume":
      row = (await resumeFocus(db, userId));
      break;
    case "stop": {
      row = (await stopFocus(db, userId));
      const stoppedToday = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
      return { session: view(row), todayMinutes: await minutesForDay(db, userId, stoppedToday), ...(await afterLog(db, userId, row.gameDay, { chapterId: row.chapterId })) };
    }
    case "idle":
      row = (await idlePause(db, userId));
      if (!row) {
        const current = await openSession(db, userId);
        return { session: current ? view(current) : null };
      }
      break;
    case "discard": {
      (await discardFocus(db, userId));
      const discardedToday = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
      return { session: null, todayMinutes: await minutesForDay(db, userId, discardedToday) };
    }
  }
  return { session: view(row) };
});
