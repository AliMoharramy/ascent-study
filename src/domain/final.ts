import type { GameConfig } from "@/config/schema";
import { addDaysIso } from "@/i18n/jalali";
import { hm, mins } from "./sleep";

/**
 * Final-phase kit (#104, F-FIN-02/03): exam-day playbook + the last-7-nights sleep plan. The sleep plan is
 * derived FROM the Sleep Program's current targets (shifts freeze in the final week) — never a second,
 * competing schedule. Not medical advice.
 */

export interface PlaybookSection {
  key: string;
  title: string;
  items: string[];
}

export const PLAYBOOK: PlaybookSection[] = [
  {
    key: "night_before",
    title: "Night before",
    items: [
      "Bag packed: admission card, ID, 2–3 pens, pencil + eraser, water, small snack, tissues, analog watch",
      "Route and departure time checked; alarm set twice (phone + backup)",
      "Clothes laid out; comfortable layers for a cold hall",
      "Only light review of your own cheat-sheets — no new topics after dinner",
      "Screens away 60 minutes before bed; wind-down ritual as usual",
      "Lights out at the sleep-plan target below — the last night is for storage, not input",
    ],
  },
  {
    key: "exam_morning",
    title: "Exam morning",
    items: [
      "Wake at the sleep-plan time; water first, then a light protein + complex-carb breakfast",
      "Leave with a 60-minute buffer; arrive at the hall 30 minutes early",
      "No gate-side cramming — it trades calm for noise",
      "Four slow breaths before entering; phone off and away",
      "Bathroom before the session, not during",
    ],
  },
  {
    key: "skip_strategy",
    title: "Skipping strategy (نزدن)",
    items: [
      "Pass 1: answer only what you know cold; mark the rest and move — no question gets more than 2× the average time",
      "Pass 2: return to marked questions with the remaining budget; start with the ones you half-know",
      "With a −⅓ wrong penalty, a blind 4-choice guess is worth exactly zero — only answer when you can eliminate at least one option",
      "Never fight one question: a hard question is hard for everyone; the points are equal",
      "Check the clock every 15 minutes and the answer-sheet row alignment every 10 questions",
      "Last 5 minutes: stop solving, verify every marked bubble is filled and aligned",
    ],
  },
  {
    key: "fuel",
    title: "Food & fuel",
    items: [
      "Small sips of water, not gulps; nuts or dark chocolate at the break",
      "Caffeine exactly as usual — exam day is not the day to experiment",
      "Avoid a heavy lunch before an afternoon session",
    ],
  },
  {
    key: "mind",
    title: "Mindset",
    items: [
      "One question at a time; the exam is a conversation, not a verdict",
      "If panic rises: feet on the floor, 4 slow breaths, next easy question",
      "The campaign was 25 weeks of honest reps — today just reads the meter",
    ],
  },
];

/** Final Ascent (#112, F-FIN-01): the last 7 days (or week 25) are review-only. No new material, ever. */
export const ASCENT_RULES = [
  "No new chapters, books or question banks — only re-read what you already studied",
  "Tests only from familiar questions: review rounds, your error log, previously seen banks",
  "No new app features or settings changes — Build Freeze is in force",
  "The sleep plan is frozen; recovery beats one more hour of input",
  "If panic rises: 3-minute breathing below, then the next easy question",
];

/** Box breathing 4-4-4-4 × 11 cycles = 176 s ≈ 3 minutes (#112, F-FIN-05). Not medical advice. */
export const BOX_BREATHING = { inhale: 4, holdIn: 4, exhale: 4, holdOut: 4, cycles: 11 } as const;

export const GROUNDING = [
  { count: 5, sense: "see", prompt: "Name 5 things you can see right now" },
  { count: 4, sense: "feel", prompt: "Notice 4 things you can physically feel (chair, feet, breath, hands)" },
  { count: 3, sense: "hear", prompt: "Listen for 3 distinct sounds" },
  { count: 2, sense: "smell", prompt: "Find 2 smells (or recall two you like)" },
  { count: 1, sense: "taste", prompt: "Notice 1 taste — a sip of water counts" },
] as const;

export interface FinalNight {
  date: string;
  bed: string;
  wake: string;
  hours: number;
  note: string;
}

/**
 * The 7 nights before the exam. `program` = the Sleep Program's CURRENT week targets (from programView).
 * Shifts freeze; if the program interval is below the final-week goal (≥ 7.5 h), bedtime walks 15 min earlier
 * per night until the goal is met, then holds. Wake time stays at the program target throughout.
 */
export function preExamSleepPlan(examDate: string, program: { wakeTarget: string; bedTarget: string }, cfg: GameConfig["sleep"], nights = 7): { nights: FinalNight[]; examDayWake: string; goalHours: number; frozen: true } {
  const goalHours = Math.max(cfg.minSleepHours, 7.5);
  const wake = mins(program.wakeTarget);
  const norm = (m: number) => (m < 12 * 60 ? m + 1440 : m);
  let bed = norm(mins(program.bedTarget));
  const currentHours = (wake + 1440 - bed) / 60;
  const out: FinalNight[] = [];
  for (let i = nights; i >= 1; i--) {
    const date = addDaysIso(examDate, -i);
    if ((wake + 1440 - bed) / 60 < goalHours) bed -= 15;
    const hours = Math.round(((wake + 1440 - bed) / 60) * 10) / 10;
    const note =
      i === 1
        ? "Exam eve: bag packed, no screens, alarms set. This night is for storage."
        : i <= 3
          ? "Hold steady — same bed and wake time as yesterday. No new shifts."
          : currentHours < goalHours
            ? "Bedtime 15 min earlier than the program target until the final-week goal is met."
            : "Program target already meets the final-week goal — keep it exactly.";
    out.push({ date, bed: hm(bed), wake: hm(wake), hours, note });
  }
  return { nights: out, examDayWake: hm(wake), goalHours, frozen: true };
}