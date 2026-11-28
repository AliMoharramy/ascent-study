import Link from "next/link";
import type { dueCardSummary } from "@/server/forge";
import type { dueStudyLogReviewSummary } from "@/server/studyLogs";
import { Card, EmptyState, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";

type AdaptiveQueue = Awaited<ReturnType<typeof dueCardSummary>>;
type FixedQueue = Awaited<ReturnType<typeof dueStudyLogReviewSummary>>;

function DueLabel({ dueOn, today }: { dueOn: string; today: string }) {
  const overdue = dueOn < today;
  return <span className={`chip shrink-0 ${overdue ? "bg-coral/15 text-coral-ink" : "bg-yellow/20 text-yellow-ink"}`}>{overdue ? "Overdue" : "Due today"}</span>;
}

export function LearningQueue({ adaptive, fixed, today }: { adaptive: AdaptiveQueue; fixed: FixedQueue; today: string }) {
  return (
    <Card className="flex flex-col gap-3" aria-label="Learning queue">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Learning queue</Eyebrow>
          <h2 className="mt-1 font-display text-title-l uppercase">Reviews due</h2>
        </div>
        <Link href="/forge?tab=review" className="btn-ghost min-h-11 px-4" aria-label="Open Forge review">
          Open Forge <Icon name="arrow" size={15} />
        </Link>
      </div>

      <div className="grid min-w-0 gap-4">
        <section className="min-w-0 rounded-2xl bg-surface-2 p-3" aria-label="Adaptive Forge cards">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-extrabold">Forge cards</h3>
              <p className="text-caption text-muted">Adaptive review · {adaptive.count} due</p>
            </div>
            <Icon name="sparkle" size={18} className="shrink-0 text-purple-ink" />
          </div>
          {adaptive.cards.length === 0 ? (
            <p className="mt-3 text-body-s text-muted">No adaptive cards are due. Cards from practice and error analysis will appear here.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {adaptive.cards.map((card) => (
                <li key={card.id} className="flex min-w-0 items-start gap-2 rounded-xl bg-surface-1 p-2.5">
                  <span className="min-w-0 flex-1 line-clamp-2 break-words text-body-s font-bold" dir="auto">{card.front}</span>
                  <DueLabel dueOn={card.dueOn} today={today} />
                </li>
              ))}
            </ul>
          )}
          {adaptive.count > adaptive.cards.length && <p className="mt-2 text-caption text-muted">Showing {adaptive.cards.length} of {adaptive.count} due cards.</p>}
        </section>

        <section className="min-w-0 rounded-2xl bg-surface-2 p-3" aria-label="Fixed Study Log reviews">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-extrabold">Study Log reviews</h3>
              <p className="text-caption text-muted">Fixed recall dates · {fixed.count} due</p>
            </div>
            <Icon name="clock" size={18} className="shrink-0 text-mint-ink" />
          </div>
          {fixed.reviews.length === 0 ? (
            <EmptyState icon="check" title="No Study Log reviews due">
              Scheduled recalls appear here on their due day, independently of focus sessions and reminders.
            </EmptyState>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {fixed.reviews.map((review) => (
                <li key={review.id} className="flex min-w-0 items-start gap-2 rounded-xl bg-surface-1 p-2.5">
                  <span className="min-w-0 flex-1 break-words text-body-s font-bold" dir="auto">{review.topic}</span>
                  <DueLabel dueOn={review.dueOn} today={today} />
                </li>
              ))}
            </ul>
          )}
          {fixed.count > fixed.reviews.length && <p className="mt-2 text-caption text-muted">Showing {fixed.reviews.length} of {fixed.count} due reviews.</p>}
        </section>
      </div>
    </Card>
  );
}
