"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch, requestId } from "./client";
import { useFeedback } from "./feedback";
import { Modal } from "./Modal";

/**
 * Keyboard-first logging (#49, F-UXD-02): S Surge, T test log, N idea, F focus mode, U undo, ? help,
 * G + letter to navigate. Ignored while typing in a field.
 */

export const SHORTCUTS: [string, string][] = [
  ["Ctrl/Cmd+K", "Command palette — jump to a page, chapter, test log or idea"],
  ["S", "Start a Surge on today's Core (×1.2 XP for 90 min)"],
  ["Space", "Start / pause the timer (Today)"],
  ["T", "Log tests (jumps to the test card)"],
  ["N", "Park an idea in the Idea Vault (≤ 30 s)"],
  ["F", "Fullscreen focus mode"],
  ["U", "Undo the last log (10-minute window)"],
  ["G then T/P/M/A/K/H/R/I/C/X", "Go to Today / Plan / Map / Arena / Forge (K) / Habits / Review / Ideas / Character / Codex (X)"],
  ["?", "This help"],
];

const NAV: Record<string, string> = { t: "/today", p: "/plan", m: "/map", a: "/arena", k: "/forge", h: "/habits", r: "/review", i: "/ideas", c: "/character", x: "/codex", s: "/settings", b: "/rest" };

export function Shortcuts() {
  const router = useRouter();
  const { toast } = useFeedback();
  const [help, setHelp] = useState(false);
  const [idea, setIdea] = useState(false);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const g = useRef(0);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable || document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      if (Date.now() - g.current < 1200 && NAV[k]) {
        g.current = 0;
        e.preventDefault();
        router.push(NAV[k]!);
        return;
      }
      if (k === "g") {
        g.current = Date.now();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      } else if (k === "n") {
        e.preventDefault();
        setIdea(true);
      } else if (k === "f") {
        e.preventDefault();
        router.push("/focus");
      } else if (k === "t") {
        e.preventDefault();
        if (location.pathname !== "/today") router.push("/today#tests");
        else window.dispatchEvent(new Event("ascent:focus-tests"));
      } else if (k === "s") {
        e.preventDefault();
        try {
          const q = await apiFetch<{ quests: { id: string; title: string; kind: string; refId: string | null; refType: string | null }[] }>("/api/quests");
          const core = q.quests.find((x) => x.kind === "core");
          const chapterId = core?.refType === "chapter" ? core.refId : null;
          await apiFetch("/api/focus", { body: { action: "start", surge: true, kind: "video", chapterId, subjectId: chapterId ? chapterId.replace(/-\d+$/, "") : null, taskSource: core ? "Today" : null, taskId: core?.id ?? null, taskTitle: core?.title ?? null, clientRequestId: requestId() } });
          toast("Surge started — ×1.2 focus XP for the first 90 minutes");
        } catch (err) {
          toast((err as Error).message, "warn");
        }
      } else if (k === "u") {
        e.preventDefault();
        try {
          const u = await apiFetch<{ items: { id: string; type: string }[] }>("/api/undo");
          if (!u.items[0]) return toast("Nothing to undo in the last 10 minutes", "warn");
          await apiFetch("/api/undo", { body: { eventId: u.items[0].id } });
          toast(`Undone: ${u.items[0].type}`);
        } catch (err) {
          toast((err as Error).message, "warn");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toast]);

  async function park(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/ideas", { body: { action: "park", text, tags } });
      toast("Idea parked — it waits for Builder Hour");
      setText("");
      setTags("");
      setIdea(false);
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }

  return (
    <>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-body-s font-extrabold">{k}</kbd>
              </dt>
              <dd className="text-body-s">{d}</dd>
            </div>
          ))}
        </dl>
      </Modal>
      <Modal open={idea} onClose={() => setIdea(false)} title="Park an idea">
        <form onSubmit={park} className="flex flex-col gap-3">
          <label>
            <span className="label">Idea (one line)</span>
            <input className="field" dir="auto" autoFocus required minLength={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. fitoloc onboarding flow" />
          </label>
          <label>
            <span className="label">Tags</span>
            <input className="field" dir="auto" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fitoloc, business, code, life" />
          </label>
          <p className="text-caption text-muted">Parked ideas can&apos;t be started until Builder Hour. Value/effort can be set later in the Vault.</p>
          <button className="btn-accent self-start" type="submit">
            Park it <kbd className="rounded bg-black/25 px-1.5 text-caption">Enter</kbd>
          </button>
        </form>
      </Modal>
    </>
  );
}
