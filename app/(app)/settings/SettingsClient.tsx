"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, cx, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { NotificationsCard } from "./NotificationsCard";

type Backup = { name: string; bytes: number; createdAt: string };
type Preview = {
  rows: { line: number; date: string; blocks: { minutes: number }[]; tests: { correct: number; wrong: number; blank: number } | null; energy: (number | null)[] }[];
  errors: { line: number; message: string }[];
  summary: { days: number; studyMinutes: number; tests: number; checkins: number };
};

export function SettingsClient({ theme: initialTheme, backups: initialBackups, backupsSupported }: { theme: "night" | "cream"; backups: Backup[]; backupsSupported: boolean }) {
  const [theme, setTheme] = useState(initialTheme);
  const [backups, setBackups] = useState(initialBackups);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function switchTheme(t: "night" | "cream") {
    setTheme(t);
    document.documentElement.dataset.theme = t; // no reload (F-CORE-11)
    await apiFetch("/api/prefs", { method: "PATCH", body: { theme: t } });
  }

  async function backupNow() {
    setBusy("backup");
    try {
      const r = await apiFetch<{ backup: Backup }>("/api/backups", { body: {} });
      setBackups((b) => [r.backup, ...b.filter((x) => x.name !== r.backup.name)]);
      setNote(`Backup ${r.backup.name} created`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runPreview(commit: boolean) {
    setBusy("import");
    setNote(null);
    try {
      const r = await apiFetch<{ preview: Preview; result?: { imported: string[]; skipped: string[] } }>("/api/import/day0", { body: { csv, commit } });
      setPreview(r.preview);
      if (r.result) setNote(`Imported ${r.result.imported.length} day(s)${r.result.skipped.length ? `, skipped ${r.result.skipped.length} already imported` : ""}.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await apiFetch("/api/auth/logout", { body: {} }).catch(() => null);
    window.location.href = "/login";
  }

  const fileRef = useRef<HTMLInputElement>(null);

  async function importFull(file: File) {
    if (!window.confirm("Import replaces ALL current data with the uploaded archive. A verified safety backup of the current data is taken first, and you will need to sign in again. Continue?")) return;
    setBusy("fullimport");
    setNote(null);
    try {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)ascent_csrf=([^;]+)/)?.[1] ?? "");
      const res = await fetch("/api/import/full", { method: "POST", headers: { "content-type": "application/octet-stream", "x-csrf-token": csrf }, body: file });
      const data = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `Import failed (${res.status})`);
      setNote("Import complete — reloading…");
      window.location.reload();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <Eyebrow>Theme</Eyebrow>
        <div className="mt-3 flex gap-2">
          {(["night", "cream"] as const).map((t) => (
            <button key={t} onClick={() => switchTheme(t)} aria-pressed={theme === t} className={cx("btn border-2", theme === t ? "border-purple bg-purple text-white" : "border-line text-ink")}>
              <Icon name={t === "night" ? "moon" : "sun"} size={16} /> {t === "night" ? "Night" : "Cream"}
            </button>
          ))}
        </div>
        <button onClick={signOut} className="btn-ghost mt-6">
          <Icon name="logout" size={16} /> Sign out
        </button>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <Eyebrow>Backups · nightly · encrypted · keep 30</Eyebrow>
          <button onClick={backupNow} className="btn-accent py-2" disabled={busy === "backup" || !backupsSupported}>
            <Icon name="download" size={16} /> Back up now
          </button>
        </div>
        <ul className="mt-3 grid max-h-56 gap-1 overflow-auto text-body-s">
          {!backupsSupported && <li className="text-muted">Stored backups are not set up on this deployment (they need OFFSITE_KEY). Use “Export all data” below to keep your own copy.</li>}
          {backupsSupported && backups.length === 0 && <li className="text-muted">No backups yet.</li>}
          {backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-1.5">
              <span className="font-mono text-caption">{b.name}</span>
              <span className="text-muted">{(b.bytes / 1024).toFixed(0)} KB</span>
              <a className="font-extrabold text-purple-ink" href={`/api/backups/${b.name}`} download>
                Download
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-muted">Restore: see docs/runbook.md — every backup is verified when it is written and can be rehearsed with <code>npm run restore -- --drill</code>.</p>
      </Card>

      <Card className="md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Import Day-0 kit history (CSV)</Eyebrow>
          <a className="btn-ghost py-2" href="/api/import/day0" download>
            <Icon name="download" size={16} /> Template
          </a>
        </div>
        <p className="mt-2 text-body-s text-muted">Paste the CSV from the Day-0 kit (docs/day0-kit.md). Imported days are flagged manual and earn no XP.</p>
        <textarea className="field mt-3 h-36 font-mono text-caption" dir="ltr" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="date,wake,bed,study_blocks,…" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => runPreview(false)} disabled={!csv || !!busy}>
            Preview
          </button>
          <button className="btn-accent" onClick={() => runPreview(true)} disabled={!preview || preview.rows.length === 0 || !!busy}>
            <Icon name="upload" size={16} /> Import {preview?.rows.length ?? 0} day(s)
          </button>
        </div>
        {preview && (
          <div className="mt-3 grid gap-2 text-body-s">
            <p>
              <b>{preview.summary.days}</b> days · <b>{preview.summary.studyMinutes}</b> study min · <b>{preview.summary.tests}</b> tests · <b>{preview.summary.checkins}</b> check-ins
            </p>
            {preview.errors.map((e) => (
              <p key={`${e.line}${e.message}`} className="rounded-xl bg-coral/15 px-3 py-1 text-coral-ink">
                Line {e.line}: {e.message}
              </p>
            ))}
          </div>
        )}
      </Card>
      <Card className="md:col-span-2">
        <Eyebrow>Move all data · Vercel ↔ local</Eyebrow>
        <p className="mt-2 text-body-s text-muted">
          Export downloads a single verified archive with <b>everything</b> (progress, logs, plan, cards, settings; never your login sessions). Import replaces all current data with such an
          archive — e.g. download from Vercel and continue locally. A verified safety backup is taken first, and a failed import changes nothing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-accent" href="/api/export/full" download>
            <Icon name="download" size={16} /> Export all data (.json.gz)
          </a>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy === "fullimport"}>
            <Icon name="upload" size={16} /> Import all data (.json.gz)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".gz,.enc,application/gzip,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFull(f);
              e.target.value = "";
            }}
          />
        </div>
      </Card>
      <NotificationsCard />
      {note && (
        <p role="status" className="rounded-2xl bg-surface-2 px-4 py-2 text-body-s font-semibold md:col-span-2">
          {note}
        </p>
      )}
    </div>
  );
}
