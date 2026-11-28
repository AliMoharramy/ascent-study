"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { ManualFocusEntry } from "./ManualFocusEntry";

export function QuickActions({ today, testLog }: { today: string; testLog: ReactNode }) {
  const [testsOpen, setTestsOpen] = useState(false);
  const testsButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const openTests = () => setTestsOpen(true);
    window.addEventListener("ascent:focus-tests", openTests);
    if (window.location.hash === "#tests") openTests();
    return () => window.removeEventListener("ascent:focus-tests", openTests);
  }, []);

  useEffect(() => {
    if (!testsOpen) return;
    const input = document.querySelector<HTMLInputElement>("#tests input");
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "nearest" });
  }, [testsOpen]);

  return (
    <section className="card flex flex-col gap-3" aria-label="Quick actions">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>Quick actions</Eyebrow>
          <h2 className="mt-1 font-display text-title-l uppercase">Keep moving</h2>
        </div>
        <p className="text-caption text-muted">Choose what you need to log or review.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Link href="/study-log" className="flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 hover:bg-surface-1">
          <Icon name="book" size={19} className="shrink-0 text-purple-ink" />
          <span className="min-w-0">
            <span className="block font-extrabold">Study Log</span>
            <span className="block text-caption text-muted">Save notes</span>
          </span>
        </Link>

        <button ref={testsButton} type="button" aria-expanded={testsOpen} aria-controls="today-test-log" onClick={() => setTestsOpen((open) => !open)} className="flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 text-start hover:bg-surface-1">
          <Icon name="check" size={19} className="shrink-0 text-lime-ink" />
          <span className="min-w-0">
            <span className="block font-extrabold">{testsOpen ? "Hide test log" : "Log tests"}</span>
            <span className="block text-caption text-muted">Practice results</span>
          </span>
        </button>

        <Link href="/forge?tab=review" className="flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 hover:bg-surface-1">
          <Icon name="sparkle" size={19} className="shrink-0 text-yellow-ink" />
          <span className="min-w-0">
            <span className="block font-extrabold">Forge review</span>
            <span className="block text-caption text-muted">Review due cards</span>
          </span>
        </Link>

        <ManualFocusEntry today={today} className="flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 text-start font-body text-body-s font-extrabold text-ink hover:bg-surface-1" />
      </div>

      <div id="today-test-log" hidden={!testsOpen}>
        {testLog}
      </div>
    </section>
  );
}
