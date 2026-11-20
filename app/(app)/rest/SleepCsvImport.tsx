"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";

type Preview = {
  header: string[];
  mapping: { date: string; bed: string; wake: string };
  preview: { line: number; date: string | null; bed: string | null; wake: string | null; minutes: number | null; error: string | null; replaces: boolean }[];
  ok: number;
  errors: number;
  replaces: number;
};

/** Sleep CSV import with column mapping + dry-run preview (#96): nothing is written until confirmed. */
export function SleepCsvImport() {
  const { toast } = useFeedback();
  const [csv, setCsv] = useState("");
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  async function preview(mapping?: Partial<Preview["mapping"]>) {
    setBusy(true);
    try {
      const r = await apiFetch<{ preview: Preview }>("/api/sleep", { body: { action: "csv_preview", csv, mapping } });
      setP(r.preview);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  async function doImport() {
    if (!p) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ result: { ok: number; errors: string[] } }>("/api/sleep", { body: { action: "csv", csv, mapping: p.mapping } });
      toast(`${r.result.ok} nights imported${r.result.errors.length ? `, ${r.result.errors.length} rows skipped` : ""}`);
      setP(null);
      setCsv("");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-2">
      <Eyebrow>Import Mi Band / Zepp CSV</Eyebrow>
      <textarea className="field min-h-24 font-mono text-caption" value={csv} onChange={(e) => { setCsv(e.target.value); setP(null); }} placeholder={"date,bed,wake\n2026-11-20,01:05,08:15"} aria-label="Sleep CSV" />
      <button className="btn-ghost self-start" disabled={!csv.trim() || busy} onClick={() => preview()}>
        Preview & map columns
      </button>
      {p && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(["date", "bed", "wake"] as const).map((k) => (
              <label key={k}>
                <span className="label">{k} column</span>
                <select className="field" value={p.mapping[k]} onChange={(e) => preview({ ...p.mapping, [k]: e.target.value })}>
                  {p.header.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-caption">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-start uppercase text-muted">
                  <th className="px-2 py-1 text-start">Line</th>
                  <th className="text-start">Night</th>
                  <th className="text-end">Sleep</th>
                  <th className="text-end">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.preview.map((r) => (
                  <tr key={r.line} className="border-t border-line">
                    <td className="px-2 py-1">{r.line}</td>
                    <td>{r.date ?? "—"} {r.bed && r.wake ? `${r.bed}→${r.wake}` : ""}</td>
                    <td className="text-end">{r.minutes != null ? `${Math.floor(r.minutes / 60)}h${r.minutes % 60}m` : "—"}</td>
                    <td className="text-end">
                      {r.error ? <span className="font-bold text-coral-ink">{r.error}</span> : r.replaces ? <Chip tone="yellow">replaces</Chip> : <Chip tone="lime">new</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-muted">
            Dry run: {p.ok} valid · {p.errors} invalid · {p.replaces} replace an existing night. Nothing is saved until you confirm.
          </p>
          <button className="btn-accent self-start" disabled={busy || p.ok === 0} onClick={doImport}>
            Import {p.ok} nights
          </button>
        </>
      )}
    </Card>
  );
}