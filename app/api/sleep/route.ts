import { z } from "zod";
import { api, body } from "@/server/http";
import { csvMappingSchema, importSleepCsv, importSleepCsvPreview, logSleep, programView, setProgramStart } from "@/server/rest";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await programView(db, userId, day(session))));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), date: z.string(), bed: z.string(), wake: z.string() }),
  z.object({ action: z.literal("csv"), csv: z.string().max(500_000), mapping: csvMappingSchema.partial().optional() }),
  z.object({ action: z.literal("csv_preview"), csv: z.string().max(500_000), mapping: csvMappingSchema.partial().optional() }),
  z.object({ action: z.literal("start"), wake: z.string(), bed: z.string() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  let r: unknown = null;
  if (b.action === "log") r = (await logSleep(db, userId, b));
  if (b.action === "csv") r = (await importSleepCsv(db, userId, b.csv, b.mapping));
  if (b.action === "csv_preview") return { preview: (await importSleepCsvPreview(db, userId, b.csv, b.mapping)) };
  if (b.action === "start") (await setProgramStart(db, userId, b.wake, b.bed));
  return { result: r, view: (await programView(db, userId, d)), ...(await afterLog(db, userId, d)) };
});
