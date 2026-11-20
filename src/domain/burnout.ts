import type { GameConfig } from "@/config/schema";

/**
 * Burnout radar (#101, F-WEL-06): low sleep + high consistency + fatigue. Every rule is returned with its
 * observed value and threshold so the UI can show exactly WHY the radar fired — a mirror, never a penalty.
 */

export interface BurnoutInput {
  sleepDebtHours: number;
  sleepDebtLimit: number;
  avgSleepHours: number | null;
  minSleepHours: number;
  energyAvg: number | null;
  moodAvg: number | null;
  checkins: number;
  consistency: number;
  focusHours: number;
}

export interface BurnoutRule {
  key: string;
  label: string;
  observed: string;
  threshold: string;
  fired: boolean;
  points: number;
}

export type BurnoutLevel = "calm" | "watch" | "warn";

const h1 = (n: number) => Math.round(n * 10) / 10;

export function burnoutRadar(i: BurnoutInput, cfg: GameConfig["burnout"]): { level: BurnoutLevel; points: number; rules: BurnoutRule[]; advice: string[] } {
  const rules: BurnoutRule[] = [
    {
      key: "sleep_debt",
      label: "Weekly sleep debt above the gentle limit",
      observed: `${h1(i.sleepDebtHours)} h`,
      threshold: `> ${i.sleepDebtLimit} h`,
      fired: i.sleepDebtHours > i.sleepDebtLimit,
      points: 2,
    },
    {
      key: "short_sleep",
      label: "Average sleep below your minimum",
      observed: i.avgSleepHours === null ? "no nights logged" : `${h1(i.avgSleepHours)} h`,
      threshold: `< ${i.minSleepHours} h`,
      fired: i.avgSleepHours !== null && i.avgSleepHours < i.minSleepHours,
      points: 2,
    },
    {
      key: "low_energy",
      label: "Energy check-ins trending low",
      observed: i.energyAvg === null ? "no check-ins" : `${h1(i.energyAvg)} / 5 (${i.checkins} check-ins)`,
      threshold: `≤ ${cfg.lowEnergyAvg} with ≥ ${cfg.minCheckins} check-ins`,
      fired: i.checkins >= cfg.minCheckins && i.energyAvg !== null && i.energyAvg <= cfg.lowEnergyAvg,
      points: 2,
    },
    {
      key: "low_mood",
      label: "Mood check-ins trending low",
      observed: i.moodAvg === null ? "no check-ins" : `${h1(i.moodAvg)} / 5 (${i.checkins} check-ins)`,
      threshold: `≤ ${cfg.lowMoodAvg} with ≥ ${cfg.minCheckins} check-ins`,
      fired: i.checkins >= cfg.minCheckins && i.moodAvg !== null && i.moodAvg <= cfg.lowMoodAvg,
      points: 1,
    },
    {
      key: "grind",
      label: "High output while tired (grinding, not flowing)",
      observed: `consistency ${Math.round(i.consistency * 100)} % · ${h1(i.focusHours)} h focus`,
      threshold: `≥ ${Math.round(cfg.highConsistency * 100)} % and ≥ ${cfg.highLoadHours} h`,
      fired: i.consistency >= cfg.highConsistency && i.focusHours >= cfg.highLoadHours,
      points: 1,
    },
  ];
  const points = rules.filter((r) => r.fired).reduce((s, r) => s + r.points, 0);
  const level: BurnoutLevel = points >= cfg.warnPoints ? "warn" : points >= cfg.watchPoints ? "watch" : "calm";
  const advice: string[] = [];
  const fired = new Set(rules.filter((r) => r.fired).map((r) => r.key));
  if (fired.has("sleep_debt") || fired.has("short_sleep")) advice.push("Protect tonight first: lights out at your bed target. A Rest Day Pass costs nothing and keeps the streak honest.");
  if (fired.has("low_energy") || fired.has("low_mood")) advice.push("Ask Archie to lighten this week's plan — moving a chapter is strategy, not failure.");
  if (fired.has("grind")) advice.push("High consistency on low fuel is the classic burnout shape. Trade one study block for a walk or an earlier night.");
  if (level === "warn") advice.push("Two or more signals are red. Consider declaring a Life Event or a full Rest Day — the campaign is 25 weeks, not one.");
  if (level === "calm") advice.push("No burnout signals right now. Keep the nightly check-in honest so the radar stays trustworthy.");
  return { level, points, rules, advice };
}

/**
 * Accountability buddy report (#101, F-SOC-01): numeric aggregates ONLY — the same privacy guard as the AI
 * adapter (F-AI-06). No names of subjects, no notes, no free text ever leaves through this report.
 */
export interface BuddySummary {
  weekNo: number;
  hours: number;
  xp: number;
  consistencyPct: number;
  netPct: number;
  sleepAvgHours: number;
  burnoutLevel: BurnoutLevel;
}

export function buddyReportText(s: BuddySummary, buddyName: string): string {
  const line = (k: string, v: string) => `${k}: ${v}`;
  return [
    `Weekly check-in for ${buddyName} — The Ascent, week ${s.weekNo}`,
    "",
    line("Focused study", `${h1(s.hours)} h`),
    line("XP earned", `${Math.round(s.xp)}`),
    line("Consistency", `${Math.round(s.consistencyPct)} %`),
    line("Test net score", `${h1(s.netPct)} %`),
    line("Average sleep", s.sleepAvgHours > 0 ? `${h1(s.sleepAvgHours)} h` : "not logged"),
    line("Burnout radar", s.burnoutLevel),
    "",
    "Numbers only — no notes, no personal text. Shared manually, with the owner's consent.",
  ].join("\n");
}