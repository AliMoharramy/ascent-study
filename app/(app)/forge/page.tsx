import { asc, sql } from "drizzle-orm";
import { queryOne } from "@/db/client";
import { chapters, subjects } from "@/db/schema";
import { requireUser } from "@/server/context";
import { allCards, causeBreakdown, dueCards, listArtifacts, listErrors } from "@/server/forge";
import { miningView, skipView, timeView } from "@/server/insights";
import { PageHeader } from "@/ui/components";
import { MascotSlot } from "@/ui/Mascot";
import { ForgeClient } from "./ForgeClient";

export const metadata = { title: "Forge" };

/** Forge (S08, #39 #55): error notebook with search/filter, spaced review (due queue), artifacts (Markdown). */
export default async function ForgePage({ searchParams }: { searchParams: Promise<{ q?: string; cause?: string; subject?: string; tab?: string }> }) {
  const sp = await searchParams;
  const { db, userId, today, cfg } = await requireUser();
  const subs = (await db.select({ id: subjects.id, name: subjects.nameEn, status: subjects.status }).from(subjects).orderBy(asc(subjects.sort))).filter((s) => s.status !== "dropped");
  const chs = (await db.select({ id: chapters.id, no: chapters.no, title: chapters.title, s: chapters.subjectId }).from(chapters).orderBy(asc(chapters.subjectId), asc(chapters.no))).filter((c) => subs.some((s) => s.id === c.s)).map((c) => ({ id: c.id, label: `${c.s.toUpperCase()} ${c.no} · ${c.title}` }));
  const reviewedToday = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM events WHERE user_id = ${userId} AND type = 'review.answered' AND game_day = ${today}`))!;
  const due = (await dueCards(db, userId, today));
  return (
    <div>
      <PageHeader eyebrow="Craft · learning assets" title="The Forge">
        <MascotSlot character="archie" state={due.length ? "thinking" : "reading"} size="xs" enabled={cfg.flags.mascots} />
      </PageHeader>
      <ForgeClient
        tab={sp.tab ?? "errors"}
        filters={{ q: sp.q ?? "", cause: sp.cause ?? "", subject: sp.subject ?? "" }}
        errors={(await listErrors(db, userId, { q: sp.q, cause: sp.cause, subjectId: sp.subject }))}
        causes={(await causeBreakdown(db, userId))}
        due={due}
        cards={(await allCards(db, userId)).length}
        artifacts={(await listArtifacts(db, userId, sp.q))}
        subjects={subs}
        chapters={chs}
        reviewXpLeft={Math.max(0, cfg.xp.reviewDailyCap - reviewedToday.n * cfg.xp.reviewCard)}
        mining={(await miningView(db, userId, today))}
        time={(await timeView(db, userId, today))}
        skip={(await skipView(db, userId, today))}
      />
    </div>
  );
}
