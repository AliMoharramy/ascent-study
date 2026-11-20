import { sql } from "drizzle-orm";
import { queryOne } from "@/db/client";
import { requireUser } from "@/server/context";
import { dailyDeck } from "@/server/forge";
import { PageHeader } from "@/ui/components";
import { DeckClient } from "./DeckClient";

export const metadata = { title: "Five-minute deck" };

/** Five-minute deck (F-LRN-16, #70): ten due/recent-error cards, reveal → again/hard/good. */
export default async function DeckPage() {
  const { db, userId, today, cfg } = await requireUser();
  const reviewedToday = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM events WHERE user_id = ${userId} AND type = 'review.answered' AND game_day = ${today}`))!;
  const deck = (await dailyDeck(db, userId, today, 10));
  const reviewXpLeft = Math.max(0, cfg.xp.reviewDailyCap - reviewedToday.n * cfg.xp.reviewCard);
  return (
    <div>
      <PageHeader eyebrow="Craft · daily ritual" title="Five-minute deck">
        <p className="text-body-s text-muted">Ten cards from today&apos;s due queue and the errors you analysed this week. Reveal, then grade yourself honestly.</p>
        <a href="/api/exports?kind=anki" download className="btn-ghost no-print" title="Your takeaways, artifacts and manual cards as an Anki text import — never test-bank questions">
          Export to Anki (.txt)
        </a>
      </PageHeader>
      <DeckClient deck={deck} reviewXpLeft={reviewXpLeft} />
    </div>
  );
}
