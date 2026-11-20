import { requireUser } from "@/server/context";
import { daysToExam, EXAM_DATE } from "@/lib/campaign";
import { formatJalali } from "@/i18n/jalali";
import { FeedbackProvider } from "@/ui/feedback";
import { xpSummary } from "@/events/projections";
import { getGoal, onboardingState } from "@/server/reviews";
import { OnboardingFlow } from "./OnboardingFlow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ch.1 · The Awakening" };

/** Onboarding (#46, F-DUO-16): story → confirm decisions → first Seed quest → first XP on the map, in ≤ 2 min. */
export default async function OnboardingPage() {
  const { db, userId, today } = await requireUser();
  return (
    <FeedbackProvider initial={(await xpSummary(db, userId, today))}>
      <main id="main" className="grid min-h-dvh place-items-center p-4">
        <OnboardingFlow daysLeft={daysToExam(today)} examFa={formatJalali(EXAM_DATE, "fa")} rerun={!!(await onboardingState(db, userId)).done} goal={(await getGoal(db, userId))?.minutes ?? null} />
      </main>
    </FeedbackProvider>
  );
}
