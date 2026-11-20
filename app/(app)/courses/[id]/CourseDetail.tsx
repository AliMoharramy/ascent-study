"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatHours, formatMinutes, type ParseResult } from "@/domain/lessonParse";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, ProgressBar } from "@/ui/components";
import { Icon } from "@/ui/icons";

type Course = { id: string; title: string; kind: string; instructor: string | null; platform: string | null; speed: number; estimated: boolean; estHoursMin: number | null; estHoursMax: number | null };
type Lesson = { id: string; no: number; title: string; durationMin: number; status: "todo" | "watching" | "done"; chapterIds: string[] };
type Chapter = { id: string; no: number; title: string };

const NEXT: Record<Lesson["status"], Lesson["status"]> = { todo: "watching", watching: "done", done: "todo" };

export function CourseDetail({ course, lessons: initial, chapters }: { course: Course; lessons: Lesson[]; chapters: Chapter[] }) {
  const router = useRouter();
  const [lessons, setLessons] = useState(initial);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"replace" | "append">(initial.length ? "append" : "replace");
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [speed, setSpeed] = useState(course.speed);
  const [importOpen, setImportOpen] = useState(initial.length === 0);

  const total = lessons.reduce((s, l) => s + l.durationMin, 0);
  const done = lessons.filter((l) => l.status === "done").reduce((s, l) => s + l.durationMin, 0);

  async function cycle(l: Lesson) {
    const status = NEXT[l.status];
    setLessons((ls) => ls.map((x) => (x.id === l.id ? { ...x, status } : x)));
    await apiFetch(`/api/lessons/${l.id}`, { method: "PATCH", body: { status } }).catch(() => router.refresh());
  }

  async function link(l: Lesson, chapterId: string) {
    const ids = chapterId ? [chapterId] : [];
    setLessons((ls) => ls.map((x) => (x.id === l.id ? { ...x, chapterIds: ids } : x)));
    await apiFetch(`/api/lessons/${l.id}`, { method: "PATCH", body: { chapterIds: ids } });
  }

  async function doImport(commit: boolean) {
    setMsg(null);
    try {
      const r = await apiFetch<{ preview: ParseResult; ms?: number; course?: { lessons: Lesson[] } }>(`/api/courses/${course.id}/lessons`, { body: { text, mode, commit } });
      setPreview(r.preview);
      if (commit && r.course) {
        setLessons(r.course.lessons);
        setMsg(`Imported ${r.preview.lessons.length} lessons in ${r.ms} ms`);
        setText("");
        setPreview(null);
        setImportOpen(false);
        router.refresh();
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function saveSpeed(v: number) {
    setSpeed(v);
    await apiFetch(`/api/courses/${course.id}`, { method: "PATCH", body: { speed: v } });
  }

  async function remove() {
    if (!confirm("Delete this course and all its lessons?")) return;
    await apiFetch(`/api/courses/${course.id}`, { method: "DELETE" });
    router.push("/courses");
  }

  return (
    <div className="grid gap-4">
      <Link href="/courses" className="text-body-s font-extrabold text-muted hover:text-ink">
        ← Courses
      </Link>
      <Card tone="yellow" className="flex flex-col gap-3">
        <Eyebrow>{course.kind === "teaching" ? "Teaching course" : "Tips & tests course"}</Eyebrow>
        <h1 className="fa font-display text-display-m leading-tight" lang="fa" dir="rtl">
          {course.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {course.instructor && <Chip tone="dark">{course.instructor}</Chip>}
          {course.platform && <Chip tone="dark">{course.platform}</Chip>}
          <Chip tone="dark">{lessons.length} lessons</Chip>
          <Chip tone="dark">{formatHours(total)} total</Chip>
          <Chip tone="dark">{formatHours(total / speed)} at {speed}×</Chip>
          {course.estimated && lessons.length === 0 && <Chip tone="coral">Estimated {course.estHoursMin}–{course.estHoursMax} h</Chip>}
        </div>
        <div className="flex items-center gap-3">
          <ProgressBar value={done / Math.max(1, total)} tone="surface" track="dark" className="[&>div]:bg-on-color" label="Watched" />
          <span className="text-body-s font-extrabold">{Math.round((done / Math.max(1, total)) * 100)}%</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-body-s font-extrabold">
            Speed{" "}
            <select value={speed} onChange={(e) => saveSpeed(Number(e.target.value))} className="rounded-full border-2 border-on-color/70 bg-transparent px-2 py-1">
              {[1, 1.25, 1.5, 1.75, 2, 2.25, 2.5].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary py-2" onClick={() => setImportOpen((o) => !o)}>
            <Icon name="upload" size={16} /> Import lessons
          </button>
          <button className="btn py-2 text-on-color/70 hover:text-on-color" onClick={remove}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </Card>

      {importOpen && (
        <Card>
          <Eyebrow>Paste the lesson list</Eyebrow>
          <p className="mt-1 text-body-s text-muted">One per line: “12. Title — 45:10”, “Title⇥45:10”, CSV “no,title,duration”, or Persian “جلسه ۳ - عنوان (۴۵:۱۰)”.</p>
          <textarea className="field mt-3 h-44 font-mono text-caption" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={mode} onChange={(e) => setMode(e.target.value as "replace" | "append")} className="field w-auto py-2">
              <option value="replace">Replace existing</option>
              <option value="append">Append</option>
            </select>
            <button className="btn-ghost" onClick={() => doImport(false)} disabled={!text}>
              Preview
            </button>
            <button className="btn-accent" onClick={() => doImport(true)} disabled={!preview || preview.lessons.length === 0}>
              Import {preview?.lessons.length ?? 0}
            </button>
          </div>
          {preview && (
            <div className="mt-3 grid gap-1 text-body-s">
              <p>
                {preview.lessons.length} lessons · {formatMinutes(preview.totalMin)} total
              </p>
              {preview.errors.map((e) => (
                <p key={e.line} className="text-coral-ink">
                  Line {e.line}: {e.message} — “{e.text}”
                </p>
              ))}
              <ol className="max-h-40 overflow-auto rounded-xl bg-surface-2 p-2 text-caption">
                {preview.lessons.slice(0, 50).map((l) => (
                  <li key={l.line} dir="auto">
                    {l.no}. {l.title} — {formatMinutes(l.durationMin)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}
      {msg && (
        <p role="status" className="rounded-2xl bg-surface-2 px-4 py-2 text-body-s font-semibold">
          {msg}
        </p>
      )}

      <Card className="p-2 md:p-3">
        <ul className="divide-y divide-line">
          {lessons.length === 0 && <li className="p-4 text-body-s text-muted">No lessons yet — import the list above.</li>}
          {lessons.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-2 py-2.5">
              <button onClick={() => cycle(l)} title={`Status: ${l.status} (click to change)`} className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition", l.status === "done" ? "border-lime bg-lime text-on-color" : l.status === "watching" ? "border-yellow text-yellow" : "border-line text-muted")}>
                {l.status === "done" ? <Icon name="check" size={16} /> : l.status === "watching" ? <Icon name="play" size={14} /> : <span className="text-caption font-extrabold">{l.no}</span>}
                <span className="sr-only">{l.status}</span>
              </button>
              <span className={cx("min-w-0 flex-1 truncate", l.status === "done" && "text-muted line-through")} dir="auto">
                {l.title}
              </span>
              <select aria-label="Chapter" value={l.chapterIds[0] ?? ""} onChange={(e) => link(l, e.target.value)} className="max-w-[12rem] rounded-full border border-line bg-surface-2 px-2 py-1 text-caption">
                <option value="">— chapter —</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.no}. {c.title}
                  </option>
                ))}
              </select>
              <span className="w-16 text-right text-body-s text-muted">{formatMinutes(l.durationMin)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
