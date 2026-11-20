"use client";

import { useCallback, useEffect, useState } from "react";
import { flushOutbox, outboxItems, removeItems, type OutboxItem } from "@/ui/offline";
import { Icon } from "@/ui/icons";

/**
 * Offline sync badge (#107): registers the service worker, replays the outbox when the connection
 * returns, and shows pending / rejected items. Rejected items stay visible until discarded — no
 * silent data loss.
 */
export function SyncProvider() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(() => {
    outboxItems().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const goOnline = () => {
      setOnline(true);
      void flushOutbox().then(refresh);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("ascent:offline", refresh);
    refresh();
    if (navigator.onLine) void flushOutbox().then(refresh);
    const iv = setInterval(() => {
      if (navigator.onLine) void flushOutbox().then(refresh);
    }, 60_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("ascent:offline", refresh);
      clearInterval(iv);
    };
  }, [refresh]);

  async function syncNow() {
    setBusy(true);
    await flushOutbox();
    refresh();
    setBusy(false);
  }

  async function discard(id: string) {
    await removeItems([id]);
    refresh();
  }

  if (items.length === 0 && online) return null;
  const rejected = items.filter((i) => i.error);
  return (
    <div className="fixed bottom-24 start-4 z-50 md:bottom-4">
      {open && (
        <div className="mb-2 w-80 rounded-2xl border border-line bg-surface-1 p-3 shadow-card">
          <p className="mb-2 text-caption font-extrabold uppercase text-muted">Offline queue</p>
          {items.length === 0 ? (
            <p className="text-body-s text-muted">Everything is synced.</p>
          ) : (
            <ul className="grid max-h-64 gap-1.5 overflow-y-auto">
              {items.map((i) => (
                <li key={i.id} className="rounded-xl bg-surface-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-body-s capitalize">{i.kind}</b>
                    <span className="text-caption text-muted">{i.createdAt.slice(0, 16).replace("T", " ")}</span>
                  </div>
                  {i.error ? (
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <p className="text-caption text-coral-ink">{i.error}</p>
                      <button type="button" className="shrink-0 text-caption font-extrabold text-purple-ink underline" onClick={() => discard(i.id)}>
                        Discard
                      </button>
                    </div>
                  ) : (
                    <p className="text-caption text-muted">Waiting for connection…</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn mt-2 w-full bg-purple text-white" onClick={syncNow} disabled={busy || !online}>
            {busy ? "Syncing…" : online ? "Sync now" : "Offline — will retry automatically"}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`chip flex items-center gap-1.5 border px-3 py-2 font-extrabold shadow-card ${rejected.length ? "border-coral bg-coral text-on-color" : online ? "border-line bg-surface-1 text-ink" : "border-yellow bg-yellow text-on-color"}`}
      >
        <Icon name={online ? "upload" : "offline"} size={14} />
        {items.length > 0 ? `${items.length} pending` : "Offline"}
      </button>
    </div>
  );
}