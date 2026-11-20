import { z } from "zod";

/**
 * Habit spec (doc 05 §2-3, F-HAB-01/02/06, T-R1-14). Implementation Intention = when (anchor or time window)
 * + where + exact action per tier + metric. Max 7 active habits at once (anti-goal A6).
 */

export const PILLARS = ["mind", "body", "rest", "craft", "bonds", "learn", "read"] as const;
export const HABIT_STATUSES = ["proposed", "trial", "active", "mastered", "archived"] as const;
export const MAX_ACTIVE_HABITS = 7;

export const habitSpecSchema = z
  .object({
    key: z.string().max(60).nullish(),
    title: z.string().trim().min(2).max(120),
    pillar: z.enum(PILLARS),
    identity: z.string().trim().max(200).default(""),
    anchor: z.string().trim().max(200).default(""),
    place: z.string().trim().max(120).default(""),
    timeWindow: z.string().trim().max(40).default(""),
    tiers: z.object({ seed: z.string().trim().max(200), standard: z.string().trim().max(200), stretch: z.string().trim().max(200).default("") }),
    metric: z.object({ type: z.enum(["check", "duration_min", "count"]), standard: z.number().min(0).default(1) }),
    temptation: z.string().trim().max(200).default(""),
    envPrep: z.string().trim().max(200).default(""),
    daysPerWeek: z.number().int().min(1).max(7).default(7),
    contractSs: z.number().max(0).min(-20).default(0),
    xp: z.number().min(0).max(50).default(10),
    status: z.enum(HABIT_STATUSES).default("trial"),
  })
  .superRefine((h, ctx) => {
    if (h.status === "proposed" || h.status === "archived") return;
    // Implementation Intention: "I will [standard] at/after [anchor or time] in [place]"
    if (!h.anchor && !h.timeWindow) ctx.addIssue({ code: "custom", path: ["anchor"], message: "When? Give an anchor (after …) or a time window" });
    if (!h.tiers.seed) ctx.addIssue({ code: "custom", path: ["tiers", "seed"], message: "Every habit needs a 2-minute Seed version" });
    if (!h.tiers.standard) ctx.addIssue({ code: "custom", path: ["tiers", "standard"], message: "What exactly is the Standard action?" });
    if (!h.place) ctx.addIssue({ code: "custom", path: ["place"], message: "Where? (place makes the cue obvious)" });
  });

export type HabitSpec = z.output<typeof habitSpecSchema>;

export function implementationIntention(h: Pick<HabitSpec, "anchor" | "timeWindow" | "place" | "tiers">): string {
  const when = h.anchor ? h.anchor : `at ${h.timeWindow}`;
  return `${when}${h.place ? ` · ${h.place}` : ""} → ${h.tiers.standard}`;
}

export function canActivate(activeCount: number): { ok: boolean; reason?: string } {
  return activeCount < MAX_ACTIVE_HABITS ? { ok: true } : { ok: false, reason: `At most ${MAX_ACTIVE_HABITS} active habits — master or archive one first` };
}

/** Lifecycle: trial 14 days → active; mastered after ≥ 66 days with consistency ≥ 80 % (doc 05 §11). */
export function lifecycle(status: HabitSpec["status"], daysSinceStart: number, consistency30: number): HabitSpec["status"] {
  if (status === "trial" && daysSinceStart >= 14) return "active";
  if (status === "active" && daysSinceStart >= 66 && consistency30 >= 0.8) return "mastered";
  return status;
}

/** Default habits of this project (doc 05 §3). The first 7 start in trial; the rest are proposed. */
export const DEFAULT_HABITS: z.input<typeof habitSpecSchema>[] = [
  { key: "core_block", title: "Core Study Block", pillar: "mind", identity: "I am someone who studies every day", anchor: "after breakfast (or with Surge)", place: "desk", tiers: { seed: "Open the book/video: first section, 5 min", standard: "Today's Core share (Planner)", stretch: "+25 %" }, metric: { type: "duration_min", standard: 60 }, status: "trial", xp: 0 },
  { key: "foundations_10", title: "Foundations: 10 tests", pillar: "mind", anchor: "after breakfast / Saturday commute", place: "desk or bus", tiers: { seed: "3 tests", standard: "10 tests", stretch: "15 tests" }, metric: { type: "count", standard: 10 }, status: "trial", xp: 0 },
  { key: "english_20", title: "English: 20 minutes", pillar: "mind", anchor: "after lunch", place: "desk", tiers: { seed: "5 min vocabulary", standard: "20 min study/tests", stretch: "30 min" }, metric: { type: "duration_min", standard: 20 }, status: "trial", xp: 0 },
  { key: "error_analysis", title: "Error Analysis", pillar: "mind", anchor: "at the end of every test session", place: "desk", tiers: { seed: "Analyse 1 wrong answer", standard: "Analyse all wrong answers", stretch: "+ write one Forge note" }, metric: { type: "count", standard: 3 }, status: "trial", xp: 0 },
  { key: "sleep_program", title: "Sleep Program", pillar: "rest", identity: "I am someone who guards their sleep", anchor: "screens off, then bed", place: "bedroom", tiers: { seed: "Log bed & wake time", standard: "On time per this week's target", stretch: "On time + screens off 30 min before" }, metric: { type: "check", standard: 1 }, status: "trial", xp: 15 },
  { key: "run_morning", title: "Morning walk / run", pillar: "body", identity: "I start my day with movement", anchor: "after waking and a glass of water", place: "outside", timeWindow: "05:45–07:00", tiers: { seed: "Shoes on, 5 min walk", standard: "20 min brisk walk / light run", stretch: "30 min run" }, metric: { type: "duration_min", standard: 20 }, temptation: "favourite podcast only while running", envPrep: "clothes and shoes by the door", daysPerWeek: 4, contractSs: -4, status: "trial", xp: 10 },
  { key: "read_bed", title: "Book before bed", pillar: "read", anchor: "after brushing teeth", place: "bed", tiers: { seed: "1 page", standard: "20 minutes", stretch: "30 minutes" }, metric: { type: "duration_min", standard: 20 }, envPrep: "book on the pillow", status: "trial", xp: 10 },
  { key: "spaced_review", title: "Spaced Review", pillar: "mind", anchor: "after lunch", place: "desk", tiers: { seed: "3 cards", standard: "All due cards", stretch: "" }, metric: { type: "count", standard: 10 }, status: "proposed", xp: 0 },
  { key: "forge", title: "Forge a learning asset", pillar: "craft", anchor: "end of a chapter", place: "desk", tiers: { seed: "One 'lesson learned' sentence", standard: "One-page chapter sheet", stretch: "" }, metric: { type: "check", standard: 1 }, status: "proposed", xp: 0 },
  { key: "screens_off", title: "Screens off 30 min before bed", pillar: "rest", anchor: "at the bedtime alarm", place: "home", tiers: { seed: "5 minutes", standard: "30 minutes", stretch: "45 minutes" }, metric: { type: "duration_min", standard: 30 }, status: "proposed", xp: 5 },
  { key: "learn_slot", title: "Weekly learning slot", pillar: "learn", anchor: "after Core is done", place: "desk", tiers: { seed: "5 minutes", standard: "30 minutes", stretch: "" }, metric: { type: "duration_min", standard: 30 }, daysPerWeek: 3, status: "proposed", xp: 10 },
  { key: "bonds", title: "Connection", pillar: "bonds", anchor: "evening walk", place: "anywhere", tiers: { seed: "One short message", standard: "Call or meet someone", stretch: "" }, metric: { type: "check", standard: 1 }, daysPerWeek: 2, contractSs: -4, status: "proposed", xp: 10 },
  { key: "idea_capture", title: "Idea Capture", pillar: "craft", anchor: "when an idea pops up", place: "Idea Vault (N)", tiers: { seed: "Park the idea in one line", standard: "Park + value/effort", stretch: "" }, metric: { type: "check", standard: 1 }, status: "proposed", xp: 0 },
];

/** Habit Scorecard (baseline week): current behaviours rated +, =, − (doc 05 §1). */
export const scorecardItemSchema = z.object({ text: z.string().trim().min(1).max(160), rating: z.enum(["+", "=", "-"]), time: z.string().max(10).default("") });
