"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { renderMarkdown } from "@/lib/markdown";
import type { sheetsView } from "@/server/sheets";

type V = Awaited<ReturnType<typeof sheetsView>>;

/** Print template: each subject is one A4 page (break-after), artifacts never split mid-block. */
export function SheetsClient({ initial }: { initial: V }) {
  const [v, setV] = useState(initial);
  const [subjects, setSubjects] = useState<string[]>(initial.catalog.map((c) => c.id));
  const [chapters, setChapters] = useState<string[]>(initial.catalog.flatMap((c) => c.chapters.map((ch) => ch.id)));
  const [busy, setBusy] = useState(false);

  async function refresh(nextSubjects: string[], nextChapters: string[]) {
    setSubjects(nextSubjects);
    setChapters(nextChapters);
    setBusy(true);
    try {
      const q = new URLSearchParams();
      q.set("subjects", nextSubjects.join(","));
      q.set("chapters", nextChapters.join(","));
      setV(await apiFetch<V>(`/api/sheets?${q}`));
    } finally {
      setBusy(false);
    }
  }

  const toggleSubject = (id: string) => refresh(subjects.includes(id) ? subjects.filter((s) => s !== id) : [...subjects, id], chapters);
  const toggleChapter = (id: string) => refresh(subjects, chapters.includes(id) ? chapters.filter((c) => c !== id) : [...chapters, id]);

  if (v.totalArtifacts === 0) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <Eyebrow>Nothing to aggregate yet</Eyebrow>
        <p className="text-body-s">Cheat-sheets are built from your own Forge artifacts — write a sheet or formula card per chapter first, then come back and print them as one page per subject.</p>
        <Link href="/forge" className="btn-accent">
          Open the Forge <Icon name="arrow" size={16} />
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="no-print flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Subjects & chapters</Eyebrow>
          <button className="btn-primary" onClick={() => window.print()} disabled={busy || v.sheets.length === 0}>
            <Icon name="download" size={16} /> Print / save PDF · {v.sheets.length} page(s)
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.catalog.map((s) => (
            <button key={s.id} aria-pressed={subjects.includes(s.id)} onClick={() => toggleSubject(s.id)} className={cx("btn border-2", subjects.includes(s.id) ? "border-purple bg-purple text-white" : "border-line text-ink")}>
              {s.nameEn} · {s.count}
            </button>
          ))}
        </div>
        {v.catalog.filter((s) => subjects.includes(s.id) && s.chapters.length > 0).map((s) => (
          <fieldset key={s.id} className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">{s.nameEn} chapters</legend>
            <span className="text-caption font-extrabold uppercase tracking-wider text-muted">{s.nameEn}:</span>
            {s.chapters.map((ch) => (
              <label key={ch.id} className={cx("chip cursor-pointer", chapters.includes(ch.id) ? "bg-mint/20" : "bg-surface-2 opacity-70")}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--c-purple))]" checked={chapters.includes(ch.id)} onChange={() => toggleChapter(ch.id)} />
                {ch.no}. {ch.title} ({ch.count})
              </label>
            ))}
          </fieldset>
        ))}
        <p className="text-caption text-muted">Each subject prints on its own A4 page. Use your browser&apos;s “Save as PDF” destination. Only your own artifacts are included — never test-bank questions.</p>
      </Card>

      {v.sheets.length === 0 && <p className="text-body-s text-muted">No artifacts match the current selection — tick a chapter back in.</p>}

      {v.sheets.map((s) => (
        <section key={s.subjectId} className="sheet-page card flex flex-col gap-4 p-6" aria-label={`${s.nameEn} cheat-sheet`}>
          <div className="flex items-baseline justify-between gap-2 border-b-2 border-line pb-2">
            <h2 className="font-display text-title-l uppercase">{s.nameEn} <span className="text-muted">· {s.nameFa}</span></h2>
            <Chip tone="surface" className="no-print">{s.artifacts.length} artifact(s)</Chip>
          </div>
          {s.artifacts.map((a) => (
            <article key={a.id} className="print-block">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-title-m font-extrabold" dir="auto">{a.title}</h3>
                <Chip tone="surface">{a.kind}</Chip>
                {a.chapterTitle && <span className="text-caption text-muted" dir="auto">{a.chapterTitle}</span>}
              </div>
              <div className="md text-body-s" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.bodyMd).html }} />
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}