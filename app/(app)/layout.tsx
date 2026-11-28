import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { asc } from "drizzle-orm";
import { chapters, subjects } from "@/db/schema";
import { requireUser } from "@/server/context";
import { campaignDay, CAMPAIGN_DAYS, daysToExam } from "@/lib/campaign";
import { formatJalali } from "@/i18n/jalali";
import { AppNav } from "@/ui/AppNav";
import { xpSummary } from "@/events/projections";
import { rollover } from "@/server/quests";
import { goalView, onboardingState } from "@/server/reviews";
import { FeedbackProvider, HeaderStats } from "@/ui/feedback";
import { ReminderBell } from "@/ui/ReminderBell";
import { remindersView } from "@/server/reminders";
import { Shortcuts } from "@/ui/Shortcuts";
import { CommandPalette, PaletteTrigger } from "@/ui/CommandPalette";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, user, userId, today, cfg } = await requireUser();
  const path = (await headers()).get("x-pathname") ?? "";
  // first visit → onboarding (Ch.1, "first win in 2 minutes")
  if (!(await onboardingState(db, userId)).done && !path.startsWith("/onboarding")) redirect("/onboarding");
  await rollover(db, userId, today);
  const day = campaignDay(today);
  const goal = (await goalView(db, userId, today));
  const paletteChapters = (await db
    .select({ id: chapters.id, title: chapters.title, no: chapters.no, subjectId: chapters.subjectId })
    .from(chapters)
    .orderBy(asc(chapters.no)))
    .map((c) => ({ id: c.id, label: `${c.subjectId.toUpperCase()} ${c.no} · ${c.title}`, subjectId: c.subjectId }));
  const paletteSubjects = (await db.select({ id: subjects.id, name: subjects.nameEn }).from(subjects).orderBy(asc(subjects.sort)));
  return (
    <FeedbackProvider initial={(await xpSummary(db, userId, today))} sound={{ enabled: cfg.flags.sounds && !cfg.flags.calm, volume: cfg.sound.volume }} calm={cfg.flags.calm}>
      <div className="min-h-dvh md:grid md:grid-cols-[84px_1fr]">
        <AppNav />
        <div className="min-w-0 pb-28 md:pb-10">
          <header className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-5 md:px-8">
            <p className="font-display text-title-l uppercase tracking-wide">
              The Ascent<span className="text-yellow">.</span>
            </p>
            <span className="chip border border-line bg-surface-1 text-ink">
              Day {day}/{CAMPAIGN_DAYS}
            </span>
            <span className="chip bg-coral text-on-color">{daysToExam(today)} days to exam</span>
            <HeaderStats goal={{ minutes: goal.goal.minutes, focus: goal.focus }} showGoal={path !== "/today"} />
            <PaletteTrigger />
            <ReminderBell initial={(await remindersView(db, userId, today))} />
            <span className="ms-auto text-body-s text-muted">
              {formatJalali(today)} · <span className="fa">{formatJalali(today, "fa")}</span> · {user.name}
            </span>
          </header>
          <main id="main" className="mx-auto max-w-[1240px] px-4 pt-5 md:px-8">{children}</main>
        </div>
      </div>
      <Shortcuts />
      <CommandPalette chapters={paletteChapters} subjects={paletteSubjects} />
    </FeedbackProvider>
  );
}
