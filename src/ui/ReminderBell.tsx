"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { cx } from "@/ui/components";
import { Icon } from "@/ui/icons";
import type { remindersView } from "@/server/reminders";

type V = Awaited<ReturnType<typeof remindersView>>;

/** Anchor-reminder bell (#97): in-app only, due nudges with a gentle tone, one tap to dismiss. */
export function ReminderBell({ initial }: { initial: V }) {
  const [v, setV] = useState(initial);
  const [open, setOpen] = useState(false);
  async function read(id: string) {
    const r = await apiFetch<V>("/api/reminders", { body: { id } }).catch(() => null);
    if (r) setV(r);
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Reminders${v.unread ? `, ${v.unread} due` : ""}`} className="relative grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-2">
        <Icon name="bell" size={18} />
        {v.unread > 0 && <span className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[11px] font-black text-on-color">{v.unread}</span>}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-40 mt-2 w-80 rounded-2xl border border-line bg-surface-1 p-3 shadow-card">
          <p className="mb-2 text-caption font-extrabold uppercase text-muted">Anchor reminders · {v.tone} tone</p>
          {!v.enabled ? (
            <p className="text-body-s text-muted">Reminders are off in Settings → Anchor reminders.</p>
          ) : v.items.length === 0 ? (
            <p className="text-body-s text-muted">Nothing scheduled today.</p>
          ) : (
            <ul className="grid max-h-80 gap-1.5 overflow-y-auto">
              {v.items.map((r) => (
                <li key={r.id} className={cx("rounded-xl px-3 py-2", r.read ? "bg-surface-2 opacity-60" : r.due ? "bg-yellow/15" : "bg-surface-2")}>
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-body-s">{r.title}</b>
                    <span className="shrink-0 text-caption font-extrabold text-muted">{r.dueAt.slice(11, 16)}</span>
                  </div>
                  <p className="fa text-caption" dir="auto">
                    {r.body}
                  </p>
                  {!r.read && r.due && (
                    <button type="button" className="mt-1 text-caption font-extrabold text-purple-ink underline" onClick={() => read(r.id)}>
                      Done / dismiss
                    </button>
                  )}
                  {!r.due && !r.read && <p className="mt-1 text-caption text-muted">due later today</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-muted">Gentle nudges, never blame. Max {v.maxPerDay}/day, in-app only.</p>
        </div>
      )}
    </div>
  );
}