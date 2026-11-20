import type { GameConfig } from "@/config/schema";

/**
 * Achievements (doc 04 §9.1, F-GAME-12) — rules over aggregated stats, so they can be re-evaluated on replay.
 * Plus anti-gaming anomaly flags (doc 04 §11): warnings only, never punishment (Honesty Pact).
 */

export interface PlayerStats {
  chaptersCleared: number;
  maxStandardStreak: number;
  comebacks: number;
  errorAnalyses: number;
  dawnWakeStreak: number; // consecutive days waking ≤ 06:30
  duelWinStreak: number;
  duelWins: number;
  tocPasses: number; // theory review rounds done
  testsTotal: number;
  focusHours: number;
  level: number;
  weeklyBossesDefeated: number;
  regionBossesDefeated: number;
  mocksTaken: number;
  reviewCards: number;
  forgeArtifacts: number;
  ideasParked: number;
  nightlyReviews: number;
  weeklyCouncils: number;
  habitsMastered: number;
  shieldsEarned: number;
  surges: number;
  bestDayFocusMin: number;
  goalDays: number;
}

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  tier: "bronze" | "silver" | "gold";
  icon: string; // emoji-free short glyph handled by the UI
  test: (s: PlayerStats) => boolean;
  progress: (s: PlayerStats) => [number, number];
}

const def = (key: string, name: string, description: string, tier: AchievementDef["tier"], icon: string, stat: keyof PlayerStats, target: number): AchievementDef => ({
  key,
  name,
  description,
  tier,
  icon,
  test: (s) => s[stat] >= target,
  progress: (s) => [Math.min(target, s[stat]), target],
});

export const ACHIEVEMENTS: AchievementDef[] = [
  def("first_light", "First Light", "Clear your first chapter", "bronze", "tower", "chaptersCleared", 1),
  def("seven_suns", "Seven Suns", "7 Standard days in a row", "silver", "sun", "maxStandardStreak", 7),
  def("comeback_kid", "Comeback Kid", "Return after a missed day", "bronze", "undo", "comebacks", 1),
  def("error_hunter", "Error Hunter", "Analyse 50 errors", "silver", "target", "errorAnalyses", 50),
  def("dawn_walker", "Dawn Walker", "Wake ≤ 06:30 for 7 days", "gold", "sun", "dawnWakeStreak", 7),
  def("shadow_slayer", "Shadow Slayer", "Win 3 duels in a row", "gold", "sword", "duelWinStreak", 3),
  def("triple_pass", "Triple Pass", "Third round of Theory", "gold", "book", "tocPasses", 3),
  def("first_duel", "Blade Drawn", "Win your first duel", "bronze", "sword", "duelWins", 1),
  def("hundred_tests", "Century", "Log 100 tests", "bronze", "check", "testsTotal", 100),
  def("thousand_tests", "Thousand Cuts", "Log 1,000 tests", "gold", "check", "testsTotal", 1000),
  def("deep_10", "Deep Diver", "10 hours of focus", "bronze", "clock", "focusHours", 10),
  def("deep_100", "Abyss Walker", "100 hours of focus", "silver", "clock", "focusHours", 100),
  def("level_10", "Initiated", "Reach level 10", "bronze", "star", "level", 10),
  def("level_25", "Strategist", "Reach level 25", "silver", "star", "level", 25),
  def("boss_1", "Giant Slayer", "Defeat a Weekly Boss", "bronze", "skull", "weeklyBossesDefeated", 1),
  def("boss_5", "Boss Rush", "Defeat 5 Weekly Bosses", "silver", "skull", "weeklyBossesDefeated", 5),
  def("gatekeeper", "Gatekeeper", "Defeat a Region Boss", "gold", "skull", "regionBossesDefeated", 1),
  def("arena_1", "Into the Arena", "Log your first mock exam", "bronze", "flag", "mocksTaken", 1),
  def("cards_100", "Memory Palace", "Review 100 cards", "silver", "layers", "reviewCards", 100),
  def("forge_5", "Smith", "Forge 5 artifacts", "bronze", "hammer", "forgeArtifacts", 5),
  def("vault_10", "Keeper of Ideas", "Park 10 ideas instead of chasing them", "bronze", "bulb", "ideasParked", 10),
  def("night_owl_review", "Quiet Ledger", "14 nightly reviews", "silver", "moon", "nightlyReviews", 14),
  def("council_4", "Council Elder", "4 Weekly Councils", "silver", "users", "weeklyCouncils", 4),
  def("habit_master", "Second Nature", "Master a habit", "gold", "flame", "habitsMastered", 1),
  def("shield_bearer", "Shield Bearer", "Earn 3 Shields", "silver", "shield", "shieldsEarned", 3),
  def("surge_10", "Lightning", "Start 10 Surges", "bronze", "bolt", "surges", 10),
  def("marathon", "Marathon Day", "6 hours of focus in one day", "silver", "flame", "bestDayFocusMin", 360),
  def("goal_14", "Committed", "Hit your daily goal 14 times", "silver", "target", "goalDays", 14),
];

export function evaluateAchievements(stats: PlayerStats, unlocked: Set<string>): string[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.key) && a.test(stats)).map((a) => a.key);
}

export interface DayActivity {
  day: string;
  tests: number;
  correct: number;
  focusMin: number;
  manualItems: number;
  totalItems: number;
}

export interface Anomaly {
  day: string;
  rule: string;
  message: string;
}

export function detectAnomalies(days: DayActivity[], cfg: GameConfig): Anomaly[] {
  const a = cfg.anomaly;
  const out: Anomaly[] = [];
  for (const d of days) {
    if (d.tests > a.maxTestsPerDay) out.push({ day: d.day, rule: "tests_per_day", message: `${d.tests} tests in one day (> ${a.maxTestsPerDay})` });
    if (d.tests >= a.perfectAccuracyMinTests && d.correct === d.tests) out.push({ day: d.day, rule: "perfect_accuracy", message: `${d.tests} tests at 100 % accuracy` });
    if (d.focusMin > a.maxFocusHoursPerDay * 60) out.push({ day: d.day, rule: "focus_hours", message: `${Math.round(d.focusMin / 60)}h of focus in one day` });
    if (d.totalItems >= 3 && d.manualItems / d.totalItems > a.manualShareWarn) out.push({ day: d.day, rule: "manual_share", message: `${d.manualItems}/${d.totalItems} entries were manual` });
  }
  return out;
}
