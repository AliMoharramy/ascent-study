/**
 * Archie coach (#102, F-AIX-01): deterministic intent routing + local reply templates. Works fully offline;
 * when remote AI is enabled the server may only send numeric aggregates — never the raw chat text (F-AI-06).
 */

export type CoachIntent = "study_report" | "quiz" | "errors" | "plan" | "lighten" | "sleep" | "burnout" | "summary" | "help";

const RULES: Array<{ intent: CoachIntent; words: RegExp[] }> = [
  { intent: "study_report", words: [
    /\bhow\s+much\b.*\b(?:study|studied|studying|focus)\b/i,
    /\bhow\s+long\s+did\s+i\s+study\b/i,
    /\bhow\s+many\b.*\b(?:study|studied|studying|focus)\b/i,
    /\b(?:study|studying)\s+(?:time|hours|sessions?|report|summary)\b/i,
    /\bfocus\s+(?:time|sessions?|report)\b/i,
    /\b(?:report|summary)\b.*\b(?:today|yesterday|week|month|days?)\b/i,
    /\b(?:show|list|report|summari[sz]e)\b.*\b(?:study|studied|focus|sessions?)\b/i,
    /چقدر.*(?:درس|مطالعه|تمرکز)|(?:گزارش|خلاصه).*(?:مطالعه|درس|تمرکز)|(?:زمان|ساعت).*(?:مطالعه|درس|تمرکز)|(?:درس|مطالعه).*(?:کردم|خواندم|خوندم|گزارش|ساعت|چقدر)/i,
    /(?:گزارش|خلاصه).*(?:امروز|دیروز|هفته|ماه|\d+\s*روز)/i,
  ] },
  { intent: "lighten", words: [/lighten|lighter|too heavy|overload|reduce.*load|سبک|کمتر.*فشار|سنگین|حجم.*کم/i] },
  { intent: "quiz", words: [/quiz|test me|flashcard|drill|کوییز|آزمون.*بگیر|بپرس|مرور.*کارت/i] },
  { intent: "errors", words: [/error|mistake|wrong|why.*fail|غلط|اشتباه|خطا|چرا.*خراب/i] },
  { intent: "sleep", words: [/sleep|bed|wake|tired|nap|خواب|بیدار|خسته|چرت/i] },
  { intent: "burnout", words: [/burnout|exhaust|overwhelm|give up|فرسود|کم آوردم|بریدن|ناامید/i] },
  { intent: "plan", words: [/plan|week|schedule|next week|برنامه|هفته|زمان.?بندی/i] },
  { intent: "summary", words: [/summary|how am i|progress|status|report|وضعیت|چطوری|گزارش|خلاصه/i] },
];

export function routeIntent(text: string): CoachIntent {
  for (const r of RULES) if (r.words.some((w) => w.test(text))) return r.intent;
  return "help";
}

export interface CoachContext {
  weekNo: number;
  daysToExam: number;
  todayXp: number;
  weekHours: number;
  planWeekHours: number;
  consistencyPct: number;
  netPct: number | null;
  sleepAvgHours: number | null;
  sleepDebtHours: number;
  burnoutLevel: "calm" | "watch" | "warn";
  dueCards: number;
  openErrors: number;
  topCause: string | null;
}

const pct = (n: number | null) => (n === null ? "no data yet" : `${n}%`);

/** Deterministic local replies from numeric context only. The server may replace the prose via remote AI. */
export function localCoachReply(intent: CoachIntent, c: CoachContext): string {
  switch (intent) {
    case "study_report":
      return `I’ll check your completed focus sessions for the requested period and break down the time by day, subject, chapter, and focus type.`;
    case "quiz":
      return c.dueCards > 0
        ? `You have ${c.dueCards} cards due in the Forge. A 15-minute recall drill right now beats re-reading. Want me to route you? Tap the chip again or open the Forge.`
        : `Nothing due right now — the deck is clear. If you want extra reps, take a short subject quiz in the Arena instead.`;
    case "errors":
      return c.openErrors > 0
        ? `${c.openErrors} unresolved mistakes are waiting in the Forge${c.topCause ? `; the most common cause is "${c.topCause}"` : ""}. Reviewing 5 of them costs ~10 minutes and is the highest-value repair you can do today.`
        : `No open mistakes — clean sheet. Keep logging tests honestly so the pattern engine has something to work with.`;
    case "plan":
      return `Week ${c.weekNo} plan: ${c.planWeekHours}h scheduled, ${c.weekHours}h logged so far. ${c.daysToExam} days to the exam. Consistency ${pct(c.consistencyPct)}, average net ${pct(c.netPct)}. ${c.weekHours < c.planWeekHours * 0.5 ? "You are behind the plan curve — protect your two best windows today." : "You are tracking the plan — keep the rhythm."}`;
    case "lighten":
      return `I can draft a lighter week: move up to 25% of this week's optional minutes to next week, hardest-optional first, core (M) items untouched. Nothing changes until you approve the proposal.`;
    case "sleep":
      return `Last week you averaged ${c.sleepAvgHours === null ? "no logged sleep" : `${c.sleepAvgHours}h`} per night; current debt ${c.sleepDebtHours}h. ${c.sleepDebtHours > 0 ? "Debt is repaid by consistent bedtimes, not one heroic night — follow this week's Sleep Program targets." : "Debt is clear. Keep the wake time fixed even on Fridays."}`;
    case "burnout":
      return c.burnoutLevel === "warn"
        ? `The burnout radar is at WARN. This is a load problem, not a character problem: today, do one standard day and nothing extra, and let me draft a lighter week. The campaign is 25 weeks — a redline week costs more than it earns.`
        : c.burnoutLevel === "watch"
          ? `Radar says WATCH — early signals, not an alarm. Guard tonight's bedtime and keep tomorrow's plan at standard size. If two more signals fire we will act.`
          : `Radar is calm. Feeling tired after honest work is normal; feeling dread is the signal to watch. Check the radar on the Rest page anytime — every rule is shown with its numbers.`;
    case "summary":
      return `Week ${c.weekNo}: ${c.weekHours}h studied, ${c.todayXp} XP today, consistency ${pct(c.consistencyPct)}, net ${pct(c.netPct)}, sleep ${c.sleepAvgHours === null ? "—" : `${c.sleepAvgHours}h`}. Burnout radar: ${c.burnoutLevel}. ${c.daysToExam} days to the exam.`;
    case "help":
      return `I am Archie — your local coach. Ask me to: quiz you, review your errors, plan or lighten your week, check sleep, or read the burnout radar. Try the chips below. Everything runs on your device; plan changes only happen after you approve them.`;
  }
}
