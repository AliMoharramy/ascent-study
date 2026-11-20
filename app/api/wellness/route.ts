import { api, body } from "@/server/http";
import { logWellness, wellnessInput, wellnessView } from "@/server/wellness";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await wellnessView(db, userId, day(session))));

export const POST = api(async ({ db, userId, req, session }) => {
  const b = wellnessInput.parse(await body(req));
  return (await logWellness(db, userId, day(session), b));
});