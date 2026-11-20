"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/ui/client";
import { Chip, cx } from "@/ui/components";
import type { TestSourceRow } from "@/server/reference";

export function TestSources({ sources }: { sources: TestSourceRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (sources.length === 0) return null;

  async function toggle(s: TestSourceRow) {
    setBusy(s.id);
    setErr(null);
    try {
      await apiFetch("/api/test-sources", { method: "PATCH", body: { id: s.id, purchased: !s.purchased } });
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-3 grid gap-2">
      {sources.map((s) => (
        <div key={s.id} className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-body-s font-bold">
            <input type="checkbox" className="h-4 w-4 accent-lime" checked={s.purchased} disabled={busy === s.id} onChange={() => toggle(s)} />
            <span className="fa" lang="fa" dir="rtl">
              {s.title}
            </span>
          </label>
          {s.approxCount !== null && <Chip tone={s.purchased ? "lime" : "surface"}>{s.approxCount.toLocaleString("en-US")} tests</Chip>}
          {s.countDetail && (
            <span className="fa text-caption text-muted" lang="fa" dir="rtl">
              {s.countDetail}
            </span>
          )}
          {s.note && (
            <p className={cx("fa w-full text-caption", /هشدار/.test(s.note) ? "text-coral-ink" : "text-muted")} lang="fa" dir="rtl">
              {s.note}
            </p>
          )}
        </div>
      ))}
      {err && <p className="text-body-s text-coral-ink">{err}</p>}
    </div>
  );
}