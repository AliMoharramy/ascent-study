import { api, body } from "@/server/http";
import { manualFocus } from "@/server/focus";
import { afterLog } from "@/server/after";

export const POST = api(async ({ db, userId, req, session }) => {
  const b = await body<Record<string, unknown>>(req);
  const r = (await manualFocus(db, userId, b as never, { tz: session.user.timezone, rolloverHour: session.user.rolloverHour }));
  return { entry: r, ...(await afterLog(db, userId, String(b.day), { chapterId: (b.chapterId as string) ?? null })) };
});
