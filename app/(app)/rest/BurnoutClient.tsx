"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { burnoutView, buddyReport } from "@/server/burnout";

type V = Awaited<ReturnType<typeof burnoutView>>;
type Report = Awaited<ReturnType<typeof buddyReport>>;

const LEVEL_TONE = { calm: "bg-lime text-on-color", watch: "bg-yellow text-on-color", warn: "bg-coral text-on-color" } as const;
const LEVEL_TEXT = { calm: "Calm — no burnout signals", watch: "Watch — early signals, guard tonight", warn: "Warn — load problem, act today" } as const;

/** Burnout radar + accountability buddy (#101): every rule shows observed vs threshold; sharing needs consent. */
export function BurnoutClient({ data }: { data: V }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(data);
  useEffect(() => {
    setV(data);
  }, [data]);
  const [name, setName] = useState(data.consent.name);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function setConsent(consented: boolean) {
    setBusy(true);
    try {
      const r = await apiFetch<V>("/api/burnout", { body: { action: "consent", consented, name } });
      setV(r);
      if (!consented) setReport(null);
      toast(consented ? "Consent recorded — you can generate the buddy report" : "Consent withdrawn — report sharing is off");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    setBusy(true);
    try {
      setReport(await apiFetch<Report>("/api/burnout", { body: { action: "report" } }));
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      toast("Report copied — send it to your buddy yourself");
    } catch {
      toast("Clipboard unavailable — use Download instead", "warn");
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ascent-buddy-week-${report.summary.weekNo}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Burnout radar · last 7 days · a mirror, never a penalty</Eyebrow>
          <Chip className={LEVEL_TONE[v.level]}>{v.level.toUpperCase()} · {v.points} pts</Chip>
        </div>
        <p className="text-body-s font-bold">{LEVEL_TEXT[v.level]}</p>
        <ul className="grid gap-1.5">
          {v.rules.map((r) => (
            <li key={r.key} className={cx("rounded-2xl px-3 py-2", r.fired ? "bg-coral/10" : "bg-surface-2")}>
              <div className="flex items-center justify-between gap-2 text-body-s font-extrabold">
                <span>{r.label}</span>
                <span className={cx("chip", r.fired ? "bg-coral text-on-color" : "bg-surface-1 text-muted")}>{r.fired ? `fired +${r.points}` : "clear"}</span>
              </div>
              <p className="mt-0.5 text-caption text-muted">
                observed: <span className="font-extrabold text-ink">{r.observed}</span> · rule: {r.threshold}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted">
          Watch at ≥ {v.thresholds.watchPoints} pts, Warn at ≥ {v.thresholds.warnPoints} pts. Window {v.window.from} → {v.window.to}. Thresholds live in Settings → config.
        </p>
        {v.advice.length > 0 && (
          <ul className="grid gap-1 border-t border-line pt-2">
            {v.advice.map((a) => (
              <li key={a} className="text-body-s">• {a}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Accountability buddy · numbers only, with your consent</Eyebrow>
        <p className="text-caption text-muted">The report contains only weekly aggregates (hours, XP, consistency, net %, sleep, radar level). No notes, no subjects, no personal text — and nothing is sent anywhere automatically.</p>
        <label>
          <span className="label">Buddy name (optional, stays on this device)</span>
          <input className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara" />
        </label>
        <button role="switch" aria-checked={v.consent.consented} disabled={busy} onClick={() => setConsent(!v.consent.consented)} className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-body-s font-bold">
          I consent to generating this report
          <span className={cx("relative h-6 w-11 rounded-pill transition", v.consent.consented ? "bg-lime" : "bg-line")}>
            <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", v.consent.consented ? "start-[22px]" : "start-0.5")} />
          </span>
        </button>
        <button className="btn-accent self-start" disabled={busy || !v.consent.consented} onClick={generate}>
          Generate weekly report
        </button>
        {report && (
          <div className="flex flex-col gap-2">
            <pre className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-3 text-caption font-bold" dir="auto">{report.text}</pre>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={copy}>Copy</button>
              <button className="btn-ghost" onClick={download}>Download .txt</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}