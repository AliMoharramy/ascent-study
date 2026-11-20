"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { aiCallLog, aiStatus, anomalyAlerts, WeeklyReviewResult } from "@/server/ai";

type Status = Awaited<ReturnType<typeof aiStatus>>;
type Log = Awaited<ReturnType<typeof aiCallLog>>;
type Anomalies = Awaited<ReturnType<typeof anomalyAlerts>>;
type Analysis = { provider: "remote" | "local"; groups: { cause: string; count: number; concepts: string[]; mission: string }[] };
type Narr = { provider: "remote" | "local"; title: string; text: string };

/** AI coach (#92–#94): guarded + capped adapter with a deterministic local fallback, weekly review, error analysis, narrative, gentle anomalies. */
export function CoachClient({ status, log, anomalies }: { status: Status; log: Log; anomalies: Anomalies }) {
  const { toast } = useFeedback();
  const [st, setSt] = useState(status);
  const [weekly, setWeekly] = useState<WeeklyReviewResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [narr, setNarr] = useState<Narr | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function run(action: "weekly" | "errors" | "narrative", refresh = false) {
    setBusy(action);
    try {
      const r = await apiFetch<{ weekly?: WeeklyReviewResult; status?: Status; analysis?: Analysis; narrative?: Narr }>("/api/ai", { body: { action, refresh } });
      if (r.weekly) setWeekly(r.weekly);
      if (r.status) setSt(r.status);
      if (r.analysis) setAnalysis(r.analysis);
      if (r.narrative) setNarr(r.narrative);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <Eyebrow>Adapter status · privacy guard + cost caps</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={st.enabled ? "lime" : "surface"}>flag {st.enabled ? "on" : "off"}</Chip>
          <Chip tone={st.keyPresent ? "lime" : "surface"}>AI_KEY {st.keyPresent ? "present" : "absent"}</Chip>
          <Chip tone={st.remoteReady ? "purple" : "surface"}>{st.remoteReady ? "remote ready" : "local provider"}</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Month cost" value={`$${st.monthCost}`} hint={`cap $${st.monthCap}`} tone={st.monthCost >= st.monthCap ? "coral" : "mint"} />
          <StatTile label="Calls today" value={st.callsToday} hint={`max ${st.maxCallsPerDay}`} tone={st.callsToday >= st.maxCallsPerDay ? "coral" : "mint"} />
        </div>
        <p className="text-caption text-muted">
          Model {st.model || "—"} · endpoint {st.baseUrl || "—"}. Only numeric aggregates leave the device (guard schema); the key lives in env AI_KEY, never in the config DB or backups. Every attempt is logged below; failures fall back to the deterministic local coach.
        </p>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Gentle anomaly alerts</Eyebrow>
        {anomalies.enabled ? (
          <>
            <ul className="grid gap-1.5">
              {anomalies.alerts.map((a) => (
                <li key={a.key} className="rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                  <Chip tone={a.severity === "warn" ? "yellow" : "mint"}>{a.severity}</Chip> <span dir="auto">{a.message}</span>
                </li>
              ))}
              {anomalies.alerts.length === 0 && <li className="text-body-s text-muted">No anomalies in the last 7 days — the mirror is calm.</li>}
            </ul>
            <p className="text-caption text-muted">Information, never blame: no penalties, no XP changes. Toggle in Settings → Feature flags.</p>
          </>
        ) : (
          <p className="text-body-s text-muted">Anomaly alerts are off in Settings → Feature flags.</p>
        )}
      </Card>
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Weekly review · structured JSON, cached per week</Eyebrow>
          <div className="flex gap-2">
            <button className="btn-accent" disabled={busy !== null} onClick={() => run("weekly")}>
              {busy === "weekly" ? "Thinking…" : weekly ? "Show cached" : "Generate"}
            </button>
            <button className="btn-ghost" disabled={busy !== null} onClick={() => run("weekly", true)}>
              Force refresh
            </button>
          </div>
        </div>
        {weekly && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={weekly.provider === "remote" ? "purple" : "surface"}>{weekly.provider} provider</Chip>
              <Chip tone="surface">{weekly.summary.hours} h focus</Chip>
              <Chip tone="surface">{weekly.summary.xp} XP</Chip>
              <Chip tone="surface">net {weekly.summary.testsNet}%</Chip>
              <Chip tone="surface">consistency {Math.round(weekly.summary.consistency * 100)}%</Chip>
              <Chip tone="surface">sleep {weekly.summary.sleepAvgHours} h</Chip>
            </div>
            <p className="text-body-s font-bold" dir="auto">
              {weekly.review.summary}
            </p>
            <ul className="list-disc ps-5 text-body-s">
              {weekly.review.patterns.map((p, i) => (
                <li key={i} dir="auto">
                  {p}
                </li>
              ))}
            </ul>
            <p className="rounded-2xl bg-yellow/20 px-3 py-2 text-body-s font-extrabold">One change: {weekly.review.oneChange}</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {weekly.review.errorGroups.map((g) => (
                <li key={g.cause} className="rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                  <b>
                    {g.cause} · {g.count}
                  </b>
                  <span className="block text-caption text-muted">{g.concepts.join(", ") || "—"}</span>
                  <span className="block text-caption font-bold text-purple-ink">{g.mission}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Error analysis · 28 days</Eyebrow>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => run("errors")}>
            {busy === "errors" ? "…" : "Analyze"}
          </button>
        </div>
        {analysis ? (
          <ul className="grid gap-1.5">
            {analysis.groups.map((g) => (
              <li key={g.cause} className="rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                <b>
                  {g.cause} · {g.count}
                </b>
                <span className="block text-caption text-muted">{g.concepts.join(", ") || "—"}</span>
                <span className="block text-caption font-bold text-purple-ink">{g.mission}</span>
              </li>
            ))}
            {analysis.groups.length === 0 && <li className="text-muted">No analyzed mistakes in the window.</li>}
          </ul>
        ) : (
          <p className="text-body-s text-muted">Clusters your mistake causes into one 25-minute mission each.</p>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Campaign narrative</Eyebrow>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => run("narrative")}>
            {busy === "narrative" ? "…" : "Narrate"}
          </button>
        </div>
        {narr ? (
          <>
            <p className="font-display text-title-m">{narr.title}</p>
            <p className="fa text-body-s" dir="auto">
              {narr.text}
            </p>
            <Chip tone={narr.provider === "remote" ? "purple" : "surface"}>{narr.provider}</Chip>
          </>
        ) : (
          <p className="text-body-s text-muted">A short second-person chapter of your campaign — hopeful, never dramatic.</p>
        )}
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>Call log · every attempt, remote or local</Eyebrow>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-caption">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="text-start uppercase text-muted">
                <th className="py-1 text-start">When</th>
                <th className="text-start">Purpose</th>
                <th className="text-start">Provider</th>
                <th className="text-end">Tokens in/out</th>
                <th className="text-end">Cost $</th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-1">{c.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{c.purpose}</td>
                  <td>
                    {c.provider} · {c.model}
                  </td>
                  <td className="text-end">
                    {c.tokensIn}/{c.tokensOut}
                  </td>
                  <td className="text-end">{c.costEst}</td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-muted">
                    No calls yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}