import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { duels, storyOverrides } from "@/db/schema";
import { applyStoryOverrides, chapterForWeek, rivalEvents, STORY_CHAPTERS } from "@/domain/story";
import { appendEvent } from "@/events/store";
import { weekNoOf } from "@/lib/campaign";
import { nowIso } from "@/lib/ids";
import { nextBoss, rivalView } from "./arena";

/** Story chapters + editable start/end text + deterministic Rival/Bonus dispatches (issue #80). */

export const storyInput = z.object({
  chapterNo: z.coerce.number().int().min(1).max(STORY_CHAPTERS.length),
  startText: z.string().trim().max(1200).default(""),
  endText: z.string().trim().max(1200).default(""),
});

export async function storyView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const overrides = (await tx.select().from(storyOverrides).where(eq(storyOverrides.userId, userId)));
  const weekNo = weekNoOf(today);
  const base = chapterForWeek(weekNo);
  const chapter = applyStoryOverrides(base, overrides);
  const rival = (await rivalView(tx, userId, today));
  const duelsWonThisWeek = (await tx.select({ id: duels.id }).from(duels).where(and(eq(duels.userId, userId), eq(duels.weekNo, weekNo), eq(duels.winner, "user")))).length;
  const boss = (await nextBoss(tx, userId, today));
  const events = rivalEvents({
    weekNo,
    enabled: rival.enabled,
    gap: rival.enabled ? rival.current.gap : 0,
    duelsWonThisWeek,
    nextBoss: boss ? (JSON.parse(boss.specJson) as { title: string }).title : null,
  });
  return {
    weekNo,
    chapter,
    currentNo: chapter.no,
    chapters: STORY_CHAPTERS.map((c) => applyStoryOverrides(c, overrides)),
    overridden: new Set(overrides.map((o) => o.chapterNo)),
    events,
    rivalEnabled: rival.enabled,
    progress: { chapter: chapter.no, of: STORY_CHAPTERS.length, weekNo },
  };
});
}

export async function saveStoryOverride(db: Db, userId: string, input: z.input<typeof storyInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = storyInput.parse(input);
  (await tx.insert(storyOverrides)
    .values({ userId, chapterNo: d.chapterNo, startText: d.startText, endText: d.endText, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: [storyOverrides.userId, storyOverrides.chapterNo], set: { startText: d.startText, endText: d.endText, updatedAt: nowIso() } }));
  (await appendEvent(tx, { userId, type: "story.overridden", payload: { chapterNo: d.chapterNo } }));
  return { chapterNo: d.chapterNo };
});
}
