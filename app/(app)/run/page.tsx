import { asc } from "drizzle-orm";
import { subjects } from "@/db/schema";
import { requireUser } from "@/server/context";
import { streakBefore } from "@/server/quests";
import { xpSummary } from "@/events/projections";
import { PageHeader } from "@/ui/components";
import { RunClient } from "./RunClient";

export const metadata = { title: "Mini-run" };

/** F-DUO-11/12: short mixed run with section performance and the celebration result screen. */
export default async function RunPage() {
  const { db, userId, today, cfg } = await requireUser();
  const visible = (await db
    .select({ id: subjects.id, name: subjects.nameEn, status: subjects.status })
    .from(subjects)
    .orderBy(asc(subjects.sort)))
    .filter((s) => s.status !== "dropped");
  return (
    <div>
      <PageHeader eyebrow="S07 · mini-run" title="Quick run" />
      <RunClient subjects={visible.map((s) => ({ id: s.id, name: s.name }))} flame={(await streakBefore(db, userId, today)).flame} todayXpAtStart={(await xpSummary(db, userId, today)).todayXp} mascots={cfg.flags.mascots} />
    </div>
  );
}
