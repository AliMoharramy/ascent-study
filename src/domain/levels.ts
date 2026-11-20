import type { GameConfig } from "@/config/schema";

/**
 * Level curve (doc 04 §4). The doc's closed form is authoritative:
 *   total XP to reach level L = base·L + (step/2)·L·(L+1)   → 120·L + 6·L·(L+1)  (L=35 → 11,760; L=40 → 14,640)
 * i.e. Σ_{n=1..L}(base + step·n): the jump from level L to L+1 costs base + step·(L+1).
 * (The doc's "xp_to_next(n) = 120 + 12·n" is off by one against its own closed form; ADR-0004 records the choice.)
 * A brand-new user is level 0 and already carries the first title ("Wanderer").
 */

type LevelCfg = GameConfig["levels"];

export function xpToNext(level: number, cfg: LevelCfg): number {
  return cfg.base + cfg.step * (level + 1);
}

/** Total XP required to reach `level` (closed form of Σ_{n=1..L}(base + step·n)). */
export function totalXpForLevel(level: number, cfg: LevelCfg): number {
  if (level <= 0) return 0;
  return cfg.base * level + (cfg.step * level * (level + 1)) / 2;
}

export interface LevelInfo {
  level: number;
  title: string;
  xpTotal: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number; // 0..1
}

export function levelFromXp(xpTotal: number, cfg: LevelCfg): LevelInfo {
  const xp = Math.max(0, xpTotal);
  // Solve step/2·L² + (base + step/2)·L − xp = 0 and correct for float error.
  const a = cfg.step / 2;
  const b = cfg.base + cfg.step / 2;
  let level = a === 0 ? Math.floor(xp / cfg.base) : Math.floor((-b + Math.sqrt(b * b + 4 * a * xp)) / (2 * a));
  while (totalXpForLevel(level + 1, cfg) <= xp) level += 1;
  while (level > 0 && totalXpForLevel(level, cfg) > xp) level -= 1;
  const floor = totalXpForLevel(level, cfg);
  const next = xpToNext(level, cfg);
  return {
    level,
    title: titleForLevel(level, cfg),
    xpTotal: xp,
    xpIntoLevel: xp - floor,
    xpForNext: next,
    progress: Math.min(1, (xp - floor) / next),
  };
}

export function titleForLevel(level: number, cfg: LevelCfg): string {
  let title = cfg.titles[0]!.title;
  for (const t of cfg.titles) if (level >= t.from) title = t.title;
  return title;
}

/** Level-ups crossed when going from `before` to `after` XP (for Level Up animations). */
export function levelUps(before: number, after: number, cfg: LevelCfg): number[] {
  const from = levelFromXp(before, cfg).level;
  const to = levelFromXp(after, cfg).level;
  const out: number[] = [];
  for (let l = from + 1; l <= to; l += 1) out.push(l);
  return out;
}
