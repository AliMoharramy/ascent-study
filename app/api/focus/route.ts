import { z } from "zod";
import { api, body } from "@/server/http";
import { completeFocusBlock, idlePause, discardFocus, minutesForDay, openSession, pauseFocus, resumeFocus, startFocus, stopFocus, view } from "@/server/focus";
import { FOCUS_BLOCK_MINUTES } from "@/domain/timer";
import { gameDay } from "@/lib/time";
import { afterLog } from "@/server/after";

export const GET = api(async ({ db, userId, session }) => {
  const open = (await openSession(db, userId));
  const day = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return { session: open ? view(open) : null, todayMinutes: (await minutesForDay(db, userId, day)), serverNow: new Date().toISOString() };
});

const action = z.object({ action: z.enum(["start", "pause", "resume", "stop", "complete-block", "discard", "idle"]), sessionId: z.string().min(1).max(80).optional() }).passthrough();

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
    case "stop":
      row = (await stopFocus(db, userId));
      break;
    case "complete-block": {
      if (!b.sessionId) throw new Error("The focus session ID is required to complete a block");
      const result = await completeFocusBlock(db, userId, b.sessionId);
      if (!result.blockCompleted) {
        return { session: view(result.session), blockCompleted: false, taskAutoCompleted: false };
      }
      row = result.session;
      break;
    }
    case "idle":
      row = (await idlePause(db, userId));
      if (!row) {
        const current = await openSession(db, userId);
        return { session: current ? view(current) : null };
      }
      break;
    case "discard": {
      const discarded = await discardFocus(db, userId);
      if (discarded.blockCompleted && discarded.session) {
        row = discarded.session;
        break;
      }
      const discardedToday = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
      return { session: null, blockCompleted: false, taskAutoCompleted: false, todayMinutes: await minutesForDay(db, userId, discardedToday) };
    }
  }
  if (row.status === "ended" && (row.minutes ?? 0) >= FOCUS_BLOCK_MINUTES) {
    const completedToday = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
    return {
      session: view(row),
      blockCompleted: true,
      taskAutoCompleted: row.taskAutoCompleted,
      todayMinutes: await minutesForDay(db, userId, completedToday),
      ...(await afterLog(db, userId, row.gameDay, { chapterId: row.chapterId })),
    };
  }
  return { session: view(row), blockCompleted: false, taskAutoCompleted: false };
});
