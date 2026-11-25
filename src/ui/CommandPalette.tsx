"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, requestId } from "./client";
import { cx, Eyebrow } from "./components";
import { useFeedback } from "./feedback";
import { Icon, type IconName } from "./icons";

type Chapter = { id: string; label: string; subjectId: string };
type Subject = { id: string; name: string };

type Action = { key: string; label: string; hint: string; icon: IconName; run: () => void; keywords?: string };

const NAV: { path: string; label: string; icon: IconName; keys: string }[] = [
  { path: "/today", label: "Today", icon: "today", keys: "home quests timer checkin" },
  { path: "/map", label: "World Map", icon: "map", keys: "chapters knowledge fog" },
  { path: "/arena", label: "Arena", icon: "sword", keys: "boss duel mock exam" },
  { path: "/forge", label: "Forge", icon: "hammer", keys: "errors review cards artifacts" },
  { path: "/deck", label: "Five-minute deck", icon: "clock", keys: "review cards due five minutes" },
  { path: "/plan", label: "Plan", icon: "calendar", keys: "triage calendar capacity" },
  { path: "/habits", label: "Habits", icon: "heart", keys: "pillars routines identity contracts" },
  { path: "/life", label: "Life pillars", icon: "sparkle", keys: "explore bonds builder league story escapes monthly" },
  { path: "/review", label: "Review", icon: "star", keys: "weekly council nightly rounds monthly spark" },
  { path: "/rest", label: "Rest & Body", icon: "moonStar", keys: "sleep rest day" },
  { path: "/ideas", label: "Idea Vault", icon: "bulb", keys: "park detour builder" },
  { path: "/character", label: "Character", icon: "user", keys: "achievements shop gold hall of fame" },
  { path: "/courses", label: "Courses", icon: "book", keys: "lessons videos" },
  { path: "/codex", label: "Codex", icon: "layers", keys: "decisions design" },
  { path: "/settings", label: "Settings", icon: "gear", keys: "config flags backup theme" },
  { path: "/arena/exam", label: "Exam simulator", icon: "clock", keys: "timer answer sheet mock" },
];

/**
 * Command palette (#69, F-UXD-01): Ctrl/Cmd+K opens instantly from a local index (no network round-trip).
 * It can navigate, jump to a chapter, log a test, park an idea or start a Surge without leaving the page.
 */
export function PaletteTrigger() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("ascent:palette"))} className="chip border border-line bg-surface-1 text-ink" aria-label="Search ⌘K — command palette">
      <Icon name="search" size={14} /> <span className="hidden sm:inline">Search</span> <kbd className="rounded bg-surface-2 px-1 text-caption font-extrabold">⌘K</kbd>
    </button>
  );
}

export function CommandPalette({ chapters, subjects }: { chapters: Chapter[]; subjects: Subject[] }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [view, setView] = useState<"list" | "test" | "idea">("list");
  const [t, setT] = useState({ subjectId: "", chapterId: "", correct: "", wrong: "", blank: "" });
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = () => {
    setOpen(false);
    setView("list");
    setQ("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setView("list");
        setQ("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => {
      setOpen(true);
      setView("list");
      setQ("");
      setIdx(0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("ascent:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ascent:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open && view === "list") requestAnimationFrame(() => input.current?.focus());
  }, [open, view]);

  async function startSurge() {
    try {
      const r = await apiFetch<{ quests: { id: string; title: string; kind: string; refId: string | null; refType: string | null }[] }>("/api/quests");
      const core = r.quests.find((x) => x.kind === "core");
      const chapterId = core?.refType === "chapter" ? core.refId : null;
      await apiFetch("/api/focus", { body: { action: "start", surge: true, kind: "video", chapterId, subjectId: chapterId ? chapterId.replace(/-\d+$/, "") : null, taskSource: core ? "Today" : null, taskId: core?.id ?? null, taskTitle: core?.title ?? null, clientRequestId: requestId() } });
      close();
      toast("Surge started — ×1.2 focus XP for the first 90 minutes");
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }

  const actions = useMemo<Action[]>(() => {
    const nav = NAV.map((n) => ({
      key: `nav:${n.path}`,
      label: n.label,
      hint: `Go · ${n.path}`,
      icon: n.icon,
      keywords: n.keys,
      run: () => {
        close();
        router.push(n.path);
      },
    }));
    const extra: Action[] = [
      {
        key: "log:test",
        label: "Log a test",
        hint: "Quick log · counts only",
        icon: "check",
        keywords: "correct wrong blank net score",
        run: () => {
          setView("test");
          setIdx(0);
        },
      },
      {
        key: "log:idea",
        label: "Park an idea",
        hint: "Idea Vault · ≤ 30 s",
        icon: "bulb",
        keywords: "vault capture",
        run: () => {
          setView("idea");
          setIdx(0);
        },
      },
      { key: "focus:surge", label: "Start a Surge", hint: "Focus timer · ×1.2 XP", icon: "bolt", keywords: "timer focus", run: startSurge },
    ];
    const ql = q.trim().toLowerCase();
    const chs = ql.length < 2 ? [] : chapters.filter((c) => `${c.label} ${c.id}`.toLowerCase().includes(ql)).slice(0, 8).map((c) => ({ key: `ch:${c.id}`, label: c.label, hint: "Chapter · open map node", icon: "map" as IconName, run: () => {
      close();
      router.push(`/map/${c.id}`);
    } }));
    const all = [...extra, ...nav];
    const filtered = ql ? all.filter((a) => `${a.label} ${a.keywords ?? ""}`.toLowerCase().includes(ql)) : all;
    return [...filtered.slice(0, Math.max(0, 8 - chs.length)), ...chs].slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, chapters, router]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  async function saveTest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
      await apiFetch("/api/tests", { body: { subjectId: t.subjectId || null, chapterId: t.chapterId || null, correct: n(t.correct), wrong: n(t.wrong), blank: n(t.blank), clientRequestId: requestId() } });
      close();
      setT({ subjectId: "", chapterId: "", correct: "", wrong: "", blank: "" });
      toast("Test logged from the palette");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  async function saveIdea(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/ideas", { body: { action: "park", text: idea, tags: "" } });
      close();
      setIdea("");
      toast("Idea parked — it waits for Builder Hour");
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const subjectChapters = chapters.filter((c) => !t.subjectId || c.subjectId === t.subjectId);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 px-3 pt-[10vh]" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="animate-pop w-[min(96vw,680px)] overflow-hidden rounded-card bg-surface-1 text-ink shadow-card" role="dialog" aria-modal="true" aria-label="Command palette">
        {view === "list" && (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Icon name="search" size={18} />
              <input
                ref={input}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIdx((i) => Math.min(actions.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter" && actions[idx]) {
                    e.preventDefault();
                    actions[idx]!.run();
                  }
                }}
                placeholder="Jump to a page, chapter, or action…"
                aria-label="Search pages, chapters and actions"
                aria-controls="palette-list"
                aria-activedescendant={actions[idx] ? `palette-${idx}` : undefined}
                className="w-full bg-transparent py-4 font-bold outline-none placeholder:text-muted"
              />
              <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-extrabold">Esc</kbd>
            </div>
            <ul ref={listRef} id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
              {actions.length === 0 && <li className="px-3 py-6 text-center text-body-s text-muted">No match. Try a chapter name or a page.</li>}
              {actions.map((a, i) => (
                <li key={a.key} id={`palette-${i}`} data-idx={i} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onMouseDown={(e) => e.preventDefault()} onClick={a.run} className={cx("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2", i === idx ? "bg-surface-2" : "hover:bg-surface-2")}>
                  <Icon name={a.icon} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="fa block truncate font-bold" dir="auto">
                      {a.label}
                    </span>
                    <span className="block truncate text-caption text-muted">{a.hint}</span>
                  </span>
                  {i === idx && <kbd className="rounded bg-surface-1 px-1.5 py-0.5 text-caption font-extrabold">Enter</kbd>}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-caption text-muted">
              <span>↑↓ navigate · Enter run · Esc close</span>
              <span>Ctrl/Cmd+K</span>
            </div>
          </>
        )}

        {view === "test" && (
          <form onSubmit={saveTest} className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <Eyebrow>Quick test log</Eyebrow>
              <button type="button" className="btn-ghost px-2 py-1 text-caption" onClick={() => setView("list")}>
                Back
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className="label">Subject</span>
                <select className="field" value={t.subjectId} onChange={(e) => setT({ ...t, subjectId: e.target.value, chapterId: "" })}>
                  <option value="">No subject</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Chapter (optional)</span>
                <select className="field" value={t.chapterId} onChange={(e) => setT({ ...t, chapterId: e.target.value })}>
                  <option value="">—</option>
                  {subjectChapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {(["correct", "wrong", "blank"] as const).map((k) => (
                <label key={k}>
                  <span className="label">{k}</span>
                  <input className="field" inputMode="numeric" autoFocus={k === "correct"} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value.replace(/\D/g, "") })} />
                </label>
              ))}
            </div>
            <button className="btn-accent self-start" disabled={busy || !(Number(t.correct) + Number(t.wrong) + Number(t.blank))}>
              <Icon name="check" size={16} /> {busy ? "Saving…" : "Log test"}
            </button>
            <p className="text-caption text-muted">Counts only — net % uses negative marking (wrong ÷ 3). Focus returns to the page after saving.</p>
          </form>
        )}

        {view === "idea" && (
          <form onSubmit={saveIdea} className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <Eyebrow>Park an idea</Eyebrow>
              <button type="button" className="btn-ghost px-2 py-1 text-caption" onClick={() => setView("list")}>
                Back
              </button>
            </div>
            <label>
              <span className="label">Idea (one line)</span>
              <input className="field" autoFocus required minLength={2} maxLength={400} dir="auto" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. fitoloc onboarding flow" />
            </label>
            <button className="btn-accent self-start" disabled={busy || idea.trim().length < 2}>
              <Icon name="bulb" size={16} /> {busy ? "Saving…" : "Park it"}
            </button>
            <p className="text-caption text-muted">Parked ideas wait for Builder Hour — the palette never opens a rabbit hole.</p>
          </form>
        )}
      </div>
    </div>
  );
}
