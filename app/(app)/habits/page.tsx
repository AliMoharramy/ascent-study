import { requireUser } from "@/server/context";
import { habitStats, scorecard, seedDefaultHabits, shapingView, MAX_ACTIVE_HABITS } from "@/server/habits";
import { identityVotesAll } from "@/server/life";
import { PageHeader } from "@/ui/components";
import { HabitsClient } from "./HabitsClient";

export const metadata = { title: "Habit Lab" };

/** Habit Lab (S12, #41): habit specs with Implementation Intention, 3 tiers, heat-map, lifecycle, Scorecard. */
export default async function HabitsPage() {
  const { db, userId, today } = await requireUser();
  (await seedDefaultHabits(db, userId, today));
  const habits = (await habitStats(db, userId, today));
  const idv = (await identityVotesAll(db, userId, today));
  return (
    <div>
      <PageHeader eyebrow={`${habits.filter((h) => h.status === "trial" || h.status === "active").length} / ${MAX_ACTIVE_HABITS} active`} title="Habit Lab" />
      <HabitsClient habits={habits} scorecard={(await scorecard(db, userId))} today={today} identity={{ self: idv.self, byHabit: Object.fromEntries(idv.byHabit) }} shaping={(await shapingView(db, userId, today))} />
    </div>
  );
}
