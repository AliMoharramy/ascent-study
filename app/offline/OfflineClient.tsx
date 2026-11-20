"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/ui/client";
import { flushOutbox, outboxItems, type OutboxItem } from "@/ui/offline";
import { Card, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";

/**
 * Offline shell (#107): served by the service worker when a navigation fails. Quick test log and
 * idea capture keep working — apiFetch parks them in the outbox and they replay on reconnect.
 */
export function OfflineClient() {
  const [correct, setCorrect] = useState("");
  const [wrong, setWrong] = useState("");
  const [blank, setBlank] = useState("");
  const [idea, setIdea] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = () => {
      outboxItems().then(setItems).catch(() => {});
    };
    const up = () => {
      setOnline(true);
      void flushOutbox().then(refresh);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("ascent:offline", refresh);
    refresh();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("ascent:offline", refresh);
    };
  }, []);

  async function logTest() {
    const c = Number(correct), w = Number(wrong), b = Number(blank || 0);
    if (!Number.isInteger(c) || !Number.isInteger(w) || c < 0 || w < 0) {
      setMsg("Enter correct and wrong counts first.");
      return;
    }
    try {
      await apiFetch("/api/tests", { body: { correct: c, wrong: w, blank: b } });
      setMsg("Logged.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save");
    }
    setCorrect("");
    setWrong("");
    setBlank("");
  }

  async function parkIdea() {
    if (idea.trim().length < 2) {
      setMsg("Write the idea first (one line is enough).");
      return;
    }
    try {
      await apiFetch("/api/ideas", { body: { action: "park", text: idea.trim() } });
      setMsg("Parked.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save");
    }
    setIdea("");
  }

  const num = "w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink";
  return (
    <main id="main" className="mx-auto grid max-w-xl gap-4 px-4 py-10">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-yellow text-on-color">
          <Icon name="offline" size={20} />
        </span>
        <div>
          <h1 className="font-display text-title-m uppercase tracking-wide">Offline mode</h1>
          <p className="text-body-s text-muted">{online ? "Connection is back — syncing your queue." : "No connection. Nothing is lost — quick logs wait here."}</p>
        </div>
      </div>

      <Card>
        <Eyebrow>Quick test log</Eyebrow>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="grid gap-1 text-caption font-extrabold text-muted">
            Correct
            <input className={num} type="number" min={0} inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value)} />
          </label>
          <label className="grid gap-1 text-caption font-extrabold text-muted">
            Wrong
            <input className={num} type="number" min={0} inputMode="numeric" value={wrong} onChange={(e) => setWrong(e.target.value)} />
          </label>
          <label className="grid gap-1 text-caption font-extrabold text-muted">
            Blank
            <input className={num} type="number" min={0} inputMode="numeric" value={blank} onChange={(e) => setBlank(e.target.value)} />
          </label>
        </div>
        <button type="button" className="btn mt-3 bg-purple text-white" onClick={logTest}>
          Save test
        </button>
      </Card>

      <Card>
        <Eyebrow>Park an idea</Eyebrow>
        <input className={`${num} mt-3`} dir="auto" placeholder="One line — get it out of your head" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={400} />
        <button type="button" className="btn mt-3 bg-mint text-on-color" onClick={parkIdea}>
          Park it
        </button>
      </Card>

      {msg && <p className="text-body-s font-bold text-yellow-ink">{msg}</p>}

      <Card>
        <Eyebrow>Waiting to sync · {items.length}</Eyebrow>
        {items.length === 0 ? (
          <p className="mt-2 text-body-s text-muted">Queue is empty.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                <span className="capitalize">{i.kind}</span>
                <span className="text-caption text-muted">{i.error ? "needs attention" : i.createdAt.slice(11, 16)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/today" className="btn mt-3 border border-line bg-surface-2 text-ink">
          Back to Today
        </Link>
      </Card>
    </main>
  );
}