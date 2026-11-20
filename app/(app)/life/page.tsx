import Link from "next/link";
import { requireUser } from "@/server/context";
import { bondsView, builderView, escapeSeries, explorationView, monthlyView } from "@/server/life";
import { leagueView } from "@/server/league";
import { storyView } from "@/server/story";
import { cx, PageHeader } from "@/ui/components";
import { LifeClient } from "./LifeClient";

export const metadata = { title: "Life" };

const TABS = [
  { key: "explore", label: "Exploration", note: "≤ 10 % of study" },
  { key: "bonds", label: "Bonds", note: "people + bedtime reading" },
  { key: "builder", label: "Builder Hour", note: "earned, never bought" },
  { key: "league", label: "Ghost League", note: "nine ghosts, one you" },
  { key: "story", label: "Story", note: "Ch.1–6 + dispatches" },
  { key: "escapes", label: "Escapes", note: "gentle ledger" },
  { key: "monthly", label: "Monthly", note: "theme + badge" },
] as const;

/** Life hub (issues #76–#80, #82–#84): exploration slot, bonds/reading, Builder Hour, Ghost League, story, escape ledger and the monthly theme. */
export default async function LifePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab = TABS.some((t) => t.key === raw) ? (raw as (typeof TABS)[number]["key"]) : "explore";
  const { db, userId, today } = await requireUser();
  const story = (await storyView(db, userId, today));
  const data = {
    explore: (await explorationView(db, userId, today)),
    bonds: (await bondsView(db, userId, today)),
    builder: (await builderView(db, userId, today)),
    league: (await leagueView(db, userId, today)),
    story: { ...story, overridden: [...story.overridden] },
    escapes: (await escapeSeries(db, userId, today, 14)),
    monthly: (await monthlyView(db, userId, today)),
  };
  const active = TABS.find((t) => t.key === tab)!;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow={`Life pillars · ${active.note}`} title={active.label}>
        <Link href="/today" className="btn-ghost">
          Today
        </Link>
      </PageHeader>
      <nav aria-label="Life sections" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/life?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={cx("chip shrink-0 py-2", t.key === tab ? "bg-purple text-white" : "border border-line bg-surface-1 text-ink")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <LifeClient tab={tab} data={data} today={today} />
    </div>
  );
}
