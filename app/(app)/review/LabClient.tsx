"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow, ProgressBar, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { experimentsView } from "@/server/experiments";
import type { ExperimentResult } from "@/domain/experiment";
import { metricValue } from "@/domain/experiment";

type V = Awaited<ReturnType<typeof experimentsView>>;

const METRICS = [
  { key: "consistency", label: "Consistency (standard days %)" },
  { key: "net", label: "Test net score (%)" },
  { key: "focus", label: "Focus minutes per day" },
] as const;

const VERDICT_TONE = { worked: "bg-lime text-on-color", didnt: "bg-coral text-on-color", inconclusive: "bg-yellow text-on-color" } as const;
const VERDICT_TEXT = { worked: "Worked — keep the change", didnt: "Backfired — revert it", inconclusive: "Inconclusive — inside the noise band" } as const;

export function ResultCard({ result, changeText }: { result: ExperimentResult; changeText?: string }) {
  const unit = result.metric === "focus" ? "min/day" : "%";
  const deltaText = result.delta === null ? "—" : `${result.delta > 0 ? "+" : ""}${result.delta}${result.metric === "focus" ? "%" : " pp"}`;
  return (
    <div className="flex flex-col gap-2">
      {changeText && <p className="text-body-s font-extrabold" dir="auto">“{changeText}”</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Chip className={VERDICT_TONE[result.verdict]}>{result.verdict.toUpperCase()}</Chip>
        <span className="text-body-s font-bold">{VERDICT_TEXT[result.verdict]}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <StatTile label="Baseline" value={result.baseline ?? "—"} unit={unit} />
        <StatTile label="During" value={result.during ?? "—"} unit={unit} />
        <StatTile label="Delta" value={deltaText} tone={result.verdict === "worked" ? "lime" : result.verdict === "didnt" ? "coral" : "surface"} hint={`threshold ${result.thresholdLabel}`} />
      </div>
      <ul className="grid gap-0.5 text-caption text-muted">
        {result.reasons.map((r) => (
          <li key={r}>• {r}</li>
        ))}
      </ul>
    </div>
  );
}

/** Experiment Lab (#105, F-DUO-17): one single-change experiment at a time; verdicts feed the Weekly Council. */
export function LabClient({ data }: { data: V }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(data);
  useEffect(() => {
    setV(data);
  }, [data]);
  const [change, setChange] = useState("");
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("consistency");
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      setV(await apiFetch<V>("/api/experiments", { body }));
      toast(okMsg);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  const a = v.active;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <Eyebrow>Run an experiment · one change, {v.config.days} days</Eyebrow>
          <p className="text-caption text-muted">
            Change exactly one thing (e.g. “tests before video”, “phone outside the room”). We compare the {v.config.days}-day window against the {v.config.days} days before it, per-day normalized. Max one running experiment.
          </p>
          <label>
            <span className="label">The one change</span>
            <input className="field" maxLength={300} value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. Do 20 tests before watching any video" disabled={!!a} dir="auto" />
          </label>
          <label>
            <span className="label">Metric to judge</span>
            <select className="field" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} disabled={!!a}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          <button className="btn-accent self-start" disabled={busy || !!a || change.trim().length < 3} onClick={() => act({ action: "start", changeText: change, metric }, "Experiment started — baseline locked")}>
            Start experiment
          </button>
          {a && <p className="text-caption font-bold text-muted">One at a time — finish or cancel the running experiment first.</p>}
        </Card>
        <Card className="flex flex-col gap-3">
          <Eyebrow>Running experiment</Eyebrow>
          {a ? (
            <>
              <p className="text-body-s font-extrabold" dir="auto">“{a.changeText}”</p>
              <p className="text-caption text-muted">
                {a.startDay} → {a.endDay} · metric: {a.metric} · baseline {metricValue(a.baseline, a.metric) ?? "—"}
                {a.metric === "focus" ? " min/day" : "%"}
              </p>
              <ProgressBar value={a.daysElapsed / a.daysTotal} tone="purple" label="Experiment progress" />
              <p className="text-body-s font-bold">Day {Math.min(a.daysElapsed, a.daysTotal)} of {a.daysTotal}</p>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || a.daysElapsed < v.config.minDays} onClick={() => act({ action: "finish", id: a.id }, "Experiment judged — result saved for the Council")}>
                  Judge now {a.daysElapsed < v.config.minDays ? `(needs ${v.config.minDays} days)` : ""}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel", id: a.id }, "Experiment cancelled — no verdict")}>Cancel</button>
              </div>
            </>
          ) : (
            <p className="text-body-s text-muted">Nothing running. The lab auto-judges a finished window on your next visit, or you can judge early after {v.config.minDays} days.</p>
          )}
          <p className="text-caption text-muted">
            Verdict rules: consistency ±{v.config.consistencyDeltaPp} pp · net ±{v.config.netDeltaPp} pp · focus ±{v.config.focusDeltaPct}% — inside the band = inconclusive.
          </p>
        </Card>
      </div>
      {v.history.length > 0 && (
        <Card className="flex flex-col gap-3">
          <Eyebrow>History · results feed the Weekly Council “one change” step</Eyebrow>
          <ul className="grid gap-3">
            {v.history.map((h) => (
              <li key={h.id} className="rounded-2xl bg-surface-2 p-3">
                <p className="mb-1 text-caption font-extrabold uppercase tracking-wider text-muted">
                  {h.startDay} → {h.endDay} · {h.metric} · {h.status}
                </p>
                {h.result ? <ResultCard result={h.result} changeText={h.changeText} /> : <p className="text-body-s font-bold" dir="auto">“{h.changeText}” — cancelled, no verdict.</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}