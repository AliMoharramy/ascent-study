import { z } from "zod";
import { addDaysIso } from "@/i18n/jalali";
import { localParts } from "@/lib/time";

export const STUDY_REVIEW_OFFSETS = [3, 7, 14, 30] as const;
export const STUDY_LOG_ANALYSIS_LEASE_MS = 5 * 60_000;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const isoGameDaySchema = z.string().refine(isValidIsoDate, "Expected a real YYYY-MM-DD date");

const optionalReference = z.string().trim().min(1).max(60).nullish();

export const studyLogSubmissionSchema = z
  .object({
    topic: z.string().trim().min(2).max(160),
    courseId: optionalReference,
    lessonId: optionalReference,
    chapterId: optionalReference,
    studiedOn: isoGameDaySchema.optional(),
    sourceText: z.string().trim().min(1).max(20_000),
    clientRequestId: z.string().trim().min(8).max(80),
    consentToRemoteAi: z.literal(true),
  })
  .strict();

export const studyLogRetrySchema = z.object({
  sourceText: z.string().trim().min(1).max(20_000),
  clientRequestId: z.string().trim().min(8).max(80),
  consentToRemoteAi: z.literal(true),
}).strict();

export const studyLogReviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), clientRequestId: z.string().trim().min(8).max(80) }).strict(),
  z.object({ action: z.literal("skip"), clientRequestId: z.string().trim().min(8).max(80) }).strict(),
  z.object({ action: z.literal("cancel"), clientRequestId: z.string().trim().min(8).max(80) }).strict(),
  z.object({ action: z.literal("snooze"), dueOn: isoGameDaySchema, clientRequestId: z.string().trim().min(8).max(80) }).strict(),
]);

const reasonSchema = z.string().trim().min(4).max(240);
const promptSchema = z
  .object({
    front: z.string().trim().min(1).max(500),
    back: z.string().trim().min(1).max(2_000),
    evidence: z.string().trim().min(1).max(300),
  })
  .strict();

export const studyLogDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("schedule"),
      reason: reasonSchema,
      reviews: z.array(promptSchema).length(4),
    })
    .strict(),
  z
    .object({ decision: z.literal("no_sequence"), reason: reasonSchema, reviews: z.tuple([]) })
    .strict(),
  z
    .object({ decision: z.literal("needs_material"), reason: reasonSchema, reviews: z.tuple([]) })
    .strict(),
]);

export type StudyLogDecision = z.infer<typeof studyLogDecisionSchema>;

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function validateStudyLogDecision(sourceText: string, candidate: unknown): StudyLogDecision {
  const decision = studyLogDecisionSchema.parse(candidate);
  if (decision.decision === "schedule") {
    const source = normalizeEvidence(sourceText);
    if (decision.reviews.some((review) => {
      const blanks = review.front.split("{{blank}}");
      if (blanks.length !== 2) return true;
      const reconstructed = normalizeEvidence(`${blanks[0]}${review.back}${blanks[1]}`);
      const evidence = normalizeEvidence(review.evidence);
      return !source.includes(evidence) || reconstructed !== evidence;
    })) {
      throw new Error("Each review must reconstruct its exact source evidence through one cloze blank");
    }
  }
  return decision;
}

export function currentStudyGameDay(now: Date, timezone: string, rolloverHour: number): string {
  const local = localParts(now, timezone);
  return local.hour < rolloverHour ? addDaysIso(local.date, -1) : local.date;
}

export function reviewDatesForStudyDay(studiedOn: string) {
  const date = isoGameDaySchema.parse(studiedOn);
  return STUDY_REVIEW_OFFSETS.map((offsetDays) => ({ offsetDays, scheduledOn: addDaysIso(date, offsetDays) }));
}
