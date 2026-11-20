/**
 * Territory Fog (F-GM-09): a chapter that sits behind the plan gathers fog. Fog is a display layer only —
 * it never hides a node or blocks a click. Cleared chapters clear their fog instantly; a settled Comeback
 * thins the fog on everything (progress visible again); an in-progress chapter only keeps a light haze.
 */

export interface FogInput {
  state: "cleared" | "progress" | "fog" | "unseen";
  plannedWeek: number | null;
  curWeek: number;
  /** Settled Comebacks in the last 7 days. */
  comebacks: number;
}

export interface FogInfo {
  pct: number; // 0..0.8 overlay opacity
  weeksBehind: number;
  label: string;
}

export function fogFor({ state, plannedWeek, curWeek, comebacks }: FogInput): FogInfo {
  if (state === "cleared" || plannedWeek == null) return { pct: 0, weeksBehind: 0, label: "No fog" };
  const weeksBehind = Math.max(0, curWeek - plannedWeek);
  if (weeksBehind === 0 && state !== "fog") return { pct: 0, weeksBehind, label: "On plan" };
  let pct = 0.22 + Math.min(3, weeksBehind) * 0.14;
  pct -= Math.min(0.45, Math.max(0, comebacks) * 0.15);
  if (state === "progress") pct *= 0.45;
  pct = Math.round(Math.max(0, Math.min(0.8, pct)) * 100) / 100;
  if (pct === 0) return { pct, weeksBehind, label: "Fog lifted" };
  return {
    pct,
    weeksBehind,
    label: state === "progress" ? `Light fog · ${weeksBehind} week(s) behind plan` : `${weeksBehind} week(s) behind plan`,
  };
}
