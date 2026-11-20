"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow, cx } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";

type Version = { version: number; reason: string; createdAt: string };

/** F-CORE-08/09: edit every game constant, validate, keep history, roll back, export/import JSON or CSV. */
export function ConfigEditor({ active, versions, csv }: { active: { version: number; config: unknown }; versions: Version[]; csv: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(JSON.stringify(active.config, null, 2));
  const [reason, setReason] = useState("Edit constants");
  const [rollbackReason, setRollbackReason] = useState("Roll back game rules");
  const [busy, setBusy] = useState(false);

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function put(payload: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const r = await apiFetch<{ active: { version: number } }>("/api/config", { method: "PUT", body: payload });
      toast(`${label} — config v${r.active.version} active`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      toast("Draft is not valid JSON", "warn");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      toast("Config must be a JSON object", "warn");
      return;
    }
    await put({ patch: parsed, reason }, "Constants saved");
  }

  async function importFile(f: File) {
    const text = await f.text();
    const format = f.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
    await put({ action: "import", format, data: text, reason }, `Imported ${f.name}`);
    if (file.current) file.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Config editor (F-CORE-08/09)</Eyebrow>
        <Chip tone="mint">Active v{active.version}</Chip>
      </div>
      <p className="text-body-s text-muted">Every save validates against the schema and becomes a new immutable version. Bad values are rejected before anything is written.</p>

      <label className="flex flex-col gap-1">
        <span className="label">Constants as JSON (advanced)</span>
        <textarea className="field min-h-56 font-mono text-caption leading-relaxed" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-52 flex-1">
          <span className="label">Reason for this change</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="btn-accent" disabled={busy} onClick={saveDraft}>
          Save as new version
        </button>
        <button className="btn-ghost" onClick={() => setDraft(JSON.stringify(active.config, null, 2))}>
          Reset draft
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button className="btn-ghost" onClick={() => download(`ascent-config-v${active.version}.json`, JSON.stringify(active.config, null, 2), "application/json")}>
          Export JSON
        </button>
        <button className="btn-ghost" onClick={() => download(`ascent-config-v${active.version}.csv`, `path,value\n${csv}`, "text/csv")}>
          Export CSV
        </button>
        <input ref={file} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <button className="btn-ghost" disabled={busy} onClick={() => file.current?.click()}>
          Import JSON / CSV
        </button>
        <span className="text-caption text-muted">CSV is `path,value` per line (arrays as JSON).</span>
      </div>

      <div className="border-t border-line pt-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Eyebrow>History & rollback</Eyebrow>
          <label className="flex items-end gap-2">
            <input className="field w-56" value={rollbackReason} onChange={(e) => setRollbackReason(e.target.value)} aria-label="Rollback reason" />
          </label>
        </div>
        <ul className="mt-2 grid gap-1">
          {[...versions].reverse().map((v) => (
            <li key={v.version} className={cx("flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 text-body-s", v.version === active.version && "bg-surface-2")}>
              <span className="w-10 font-extrabold">v{v.version}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{v.reason}</span>
              <span className="text-caption text-muted">{v.createdAt.slice(0, 10)}</span>
              {v.version === active.version ? (
                <span className="chip bg-lime text-on-color">active</span>
              ) : (
                <button className="btn-ghost px-2 py-1 text-caption" disabled={busy} onClick={() => put({ action: "rollback", version: v.version, reason: `${rollbackReason} → v${v.version}` }, `Rolled back to v${v.version}`)}>
                  Roll back
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
