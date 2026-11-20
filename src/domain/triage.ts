import type { GameConfig } from "@/config/schema";
import type { Tier } from "@/db/schema";
import { round2 } from "./xp";

/**
 * Triage engine (doc 03 §6, T-R1-08). ROI = Eq × (1 − clamp(a0, 0, 0.8)) / H.
 * Per subject, chapters sorted by ROI fill M until ≈70 % of the subject's Eq, then S until 90 %, rest C.
 * Optional chapters start in C. User overrides (tier_locked) are respected. A prerequisite of an M chapter
 * is never left in C — the engine raises it to S and says why; a manual override that does so gets a warning.
 */

export interface TriageChapter {
  id: string;
  subjectId: string;
  no: number;
  title?: string;
  optional?: boolean;
  eq: number | null; // expected share of the subject's questions (≈ sums to 1 per subject)
  a0: number | null; // 0..1 baseline net (null = unknown)
  hours: number | null; // estimated hours (video ÷ speed + tests)
  lockedTier?: Tier | null;
}

export interface Prereq {
  chapterId: string;
  requires: string;
}

export interface TriageResult {
  id: string;
  subjectId: string;
  tier: Tier;
  roi: number;
  eq: number;
  a0: number;
  hours: number;
  locked: boolean;
  why: string;
}

export function roi(eq: number, a0: number, hours: number, cfg: GameConfig): number {
  const a = Math.max(0, Math.min(cfg.triage.a0Clip, a0));
  return hours > 0 ? (eq * (1 - a)) / hours : 0;
}

export function runTriage(chapters: TriageChapter[], prereqs: Prereq[], cfg: GameConfig): { results: TriageResult[]; warnings: string[] } {
  const t = cfg.triage;
  const out = new Map<string, TriageResult>();
  const bySubject = new Map<string, TriageChapter[]>();
  for (const c of chapters) bySubject.set(c.subjectId, [...(bySubject.get(c.subjectId) ?? []), c]);

  for (const [, list] of bySubject) {
    const n = list.length;
    const eqOf = (c: TriageChapter) => (c.eq != null && c.eq >= 0 ? c.eq : 1 / n);
    const total = list.filter((c) => !c.optional).reduce((s, c) => s + eqOf(c), 0) || 1;
    const scored = list.map((c) => {
      const eq = eqOf(c);
      const a0 = c.a0 ?? t.a0Unknown;
      const hours = c.hours && c.hours > 0 ? c.hours : t.defaultChapterHours;
      return { c, eq, a0, hours, roi: roi(eq, a0, hours, cfg) };
    });
    let cum = 0;
    for (const s of [...scored].sort((a, b) => b.roi - a.roi || a.c.no - b.c.no)) {
      const base = { id: s.c.id, subjectId: s.c.subjectId, roi: round2(s.roi * 1000) / 1000, eq: s.eq, a0: s.a0, hours: s.hours };
      const roiTxt = `ROI ${(s.roi * 100).toFixed(2)} = Eq ${s.eq.toFixed(3)} × (1 − a0 ${Math.round(s.a0 * 100)}%) ÷ ${s.hours}h`;
      if (s.c.lockedTier) {
        out.set(s.c.id, { ...base, tier: s.c.lockedTier, locked: true, why: `Your override (${s.c.lockedTier}). ${roiTxt}` });
        if (!s.c.optional) cum += s.eq / total;
        continue;
      }
      if (s.c.optional) {
        out.set(s.c.id, { ...base, tier: "C", locked: false, why: `Optional chapter in the source → C. ${roiTxt}` });
        continue;
      }
      const share = cum;
      cum += s.eq / total;
      const tier: Tier = share < t.mustCoverage ? "M" : share < t.shouldCoverage ? "S" : "C";
      const band = tier === "M" ? `top ${Math.round(t.mustCoverage * 100)}%` : tier === "S" ? `next ${Math.round((t.shouldCoverage - t.mustCoverage) * 100)}%` : `last ${Math.round((1 - t.shouldCoverage) * 100)}%`;
      out.set(s.c.id, { ...base, tier, locked: false, why: `${roiTxt}; falls in the ${band} of the subject's expected questions → ${tier}` });
    }
  }

  // prerequisite rule
  const warnings: string[] = [];
  for (let pass = 0; pass < 3; pass++)
    for (const p of prereqs) {
      const dep = out.get(p.chapterId);
      const req = out.get(p.requires);
      if (!dep || !req || dep.tier !== "M" || req.tier !== "C") continue;
      if (req.locked) warnings.push(`${p.requires} is a prerequisite of M chapter ${p.chapterId} but you locked it in C`);
      else out.set(req.id, { ...req, tier: "S", why: `${req.why}; raised to S — prerequisite of M chapter ${p.chapterId}` });
    }

  return { results: chapters.map((c) => out.get(c.id)!).filter(Boolean), warnings: [...new Set(warnings)] };
}

/** Validates a manual tier override: reason required; warns when it breaks the prereq rule. */
export function checkOverride(chapterId: string, tier: Tier, reason: string, current: Map<string, Tier>, prereqs: Prereq[]): { ok: boolean; error?: string; warnings: string[] } {
  if (!reason || reason.trim().length < 3) return { ok: false, error: "A reason is required for an override", warnings: [] };
  const warnings: string[] = [];
  if (tier === "C") for (const p of prereqs) if (p.requires === chapterId && current.get(p.chapterId) === "M") warnings.push(`${chapterId} is a prerequisite of M chapter ${p.chapterId}`);
  if (tier === "M") for (const p of prereqs) if (p.chapterId === chapterId && current.get(p.requires) === "C") warnings.push(`its prerequisite ${p.requires} is in C`);
  return { ok: true, warnings };
}

export const tierWeight = (tier: Tier | null | undefined, cfg: GameConfig) => (tier ? cfg.triage.tierWeights[tier] : 0);
