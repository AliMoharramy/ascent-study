import { requireUser } from "@/server/context";
import { monthlyView } from "@/server/life";
import { monthlyReviewView } from "@/server/reviews";
import { Card, Eyebrow, StatTile } from "@/ui/components";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Monthly report" };

/** Monthly PDF (#114, F-INS-02): a clean print-optimized report of the monthly review — local print only, nothing uploaded. */
export default async function MonthlyReportPage() {
  const { db, userId, today } = await requireUser();
  const m = (await monthlyReviewView(db, userId, today));
  const theme = (await monthlyView(db, userId, today));
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-s text-muted">Use your browser&apos;s “Save as PDF” destination. This report stays on your device.</p>
        <PrintButton />
      </div>

      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>THE ASCENT · monthly report · {m.month}</Eyebrow>
        <h1 className="font-display text-display-m uppercase leading-none">{theme.theme.name}</h1>
        <p className="text-body-s font-bold" dir="auto">{theme.theme.story}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Challenge progress" value={theme.progress.value} unit={`/ ${theme.progress.target} ${theme.theme.unit}`} tone="surface" />
          <StatTile label="Standard days" value={theme.metrics.standardDays} tone="surface" />
          <StatTile label="Error analyses" value={theme.metrics.errorAnalyses} tone="surface" />
          <StatTile label="Duels won" value={theme.metrics.duelsWon} tone="surface" />
        </div>
        {theme.badge && <p className="text-body-s font-extrabold">Badge earned: {theme.badge.badge}</p>}
      </Card>

      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>Review & decision</Eyebrow>
        {m.saved ? (
          <div className="grid gap-2 text-body-s">
            <p><b>One change for next month:</b> <span dir="auto">{m.saved.oneChange}</span></p>
            <p><b>What worked:</b> <span dir="auto">{m.saved.wins || "—"}</span></p>
            <p><b>Biggest risk:</b> <span dir="auto">{m.saved.risks || "—"}</span></p>
            <p><b>Linear algebra decision:</b> {m.saved.linearAlgebra} · confidence {m.saved.confidence}/5</p>
            {m.saved.note && <p><b>Note:</b> <span dir="auto">{m.saved.note}</span></p>}
          </div>
        ) : (
          <p className="text-body-s text-muted">No monthly review saved yet — fill it in on the Review page, then print again.</p>
        )}
      </Card>

      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>Review rounds (TOC ×3)</Eyebrow>
        <p className="text-body-s font-bold">{m.rounds.done} of {m.rounds.total} rounds done · {m.rounds.overdue} overdue</p>
        <ul className="grid gap-1 text-body-s sm:grid-cols-2">
          {m.rounds.bySubject.map((s) => (
            <li key={s.id} className="rounded-xl bg-surface-2 px-3 py-1.5">
              {s.subject?.en ?? s.id}: {s.done}/3 {s.round3Done ? "· complete ✔" : ""}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>Spark pattern</Eyebrow>
        {m.spark.ready ? (
          <>
            <p className="text-body-s font-bold" dir="auto">{m.spark.note}</p>
            <p className="text-body-s">Top words: {m.spark.topWords.map((w) => `${w.word} (${w.count})`).join(" · ")}</p>
          </>
        ) : (
          <p className="text-body-s text-muted">Not enough sparks yet — the pattern appears after a few nightly reviews.</p>
        )}
      </Card>

      {m.history.length > 1 && (
        <Card className="print-block flex flex-col gap-2">
          <Eyebrow>Previous months</Eyebrow>
          <ul className="grid gap-1 text-body-s">
            {m.history.slice(1).map((h) => (
              <li key={h.date} className="rounded-xl bg-surface-2 px-3 py-1.5">
                <b>{h.date}</b> · <span dir="auto">{h.oneChange}</span> · linear algebra: {h.linearAlgebra}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}