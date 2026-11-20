import { api } from "@/server/http";
import { xpSummary } from "@/events/projections";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, session }) => (await xpSummary(db, userId, gameDay(new Date(), session.user.timezone, session.user.rolloverHour))));
