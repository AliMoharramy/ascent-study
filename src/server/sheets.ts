import { asc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { chapters, subjects } from "@/db/schema";
import { listArtifacts } from "./forge";

/**
 * Cheat-sheet builder (#113, F-LRN-08): aggregates Forge artifacts into one printable page per subject.
 * Chapter selection filters artifacts; unfiled artifacts always ride along with their subject.
 */

export interface SheetSelection {
  subjects?: string[];
  chapters?: string[];
}

export async function sheetsView(db: Db, userId: string, sel: SheetSelection = {}) {
  const arts = (await listArtifacts(db, userId));
  const chs = new Map((await db.select().from(chapters)).map((c) => [c.id, c]));
  const subs = (await db.select().from(subjects).orderBy(asc(subjects.sort)));
  const subOf = (a: { chapterId: string | null }) => (a.chapterId ? chs.get(a.chapterId)?.subjectId ?? "general" : "general");

  const general = arts.filter((a) => subOf(a) === "general");
  const catalog = subs
    .filter((s) => s.status !== "dropped")
    .map((s) => {
      const mine = arts.filter((a) => subOf(a) === s.id);
      const chapterIds = [...new Set(mine.map((a) => a.chapterId).filter((c): c is string => !!c))];
      return {
        id: s.id,
        nameEn: s.nameEn,
        nameFa: s.nameFa,
        count: mine.length,
        unfiled: 0,
        chapters: chapterIds.map((id) => ({ id, title: chs.get(id)?.title ?? id, no: chs.get(id)?.no ?? 0, count: mine.filter((a) => a.chapterId === id).length })).sort((a, b) => a.no - b.no),
      };
    })
    .filter((s) => s.count > 0);
  if (general.length) catalog.push({ id: "general", nameEn: "General", nameFa: "عمومی", count: general.length, unfiled: general.length, chapters: [] });

  const chosen = sel.subjects ?? catalog.map((c) => c.id);
  const sheets = chosen
    .map((id) => {
      if (id === "general") {
        if (!general.length) return null;
        return { subjectId: id, nameEn: "General", nameFa: "عمومی", artifacts: general.map((a) => ({ id: a.id, title: a.title, bodyMd: a.bodyMd, kind: a.kind, chapterId: a.chapterId, chapterTitle: null as string | null })) };
      }
      const sub = subs.find((s) => s.id === id);
      if (!sub || sub.status === "dropped") return null;
      let mine = arts.filter((a) => subOf(a) === id);
      if (sel.chapters) mine = mine.filter((a) => !a.chapterId || sel.chapters!.includes(a.chapterId));
      mine = [...mine].sort((a, b) => (chs.get(a.chapterId ?? "")?.no ?? 999) - (chs.get(b.chapterId ?? "")?.no ?? 999) || a.updatedAt.localeCompare(b.updatedAt));
      return {
        subjectId: id,
        nameEn: sub.nameEn,
        nameFa: sub.nameFa,
        artifacts: mine.map((a) => ({ id: a.id, title: a.title, bodyMd: a.bodyMd, kind: a.kind, chapterId: a.chapterId, chapterTitle: a.chapterId ? chs.get(a.chapterId)?.title ?? a.chapterId : null })),
      };
    })
    .filter((s): s is NonNullable<typeof s> => !!s && s.artifacts.length > 0);

  return { catalog, sheets, totalArtifacts: arts.length, generalCount: general.length };
}