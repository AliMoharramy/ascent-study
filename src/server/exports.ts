import { withUserTransaction, type Db } from "@/db/client";
import { chapters } from "@/db/schema";
import { toMin, weekdaySat } from "@/domain/capacity";
import { buildAnki, buildIcs, type IcsEvent } from "@/domain/exports";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { EXAM_DATE, TOTAL_WEEKS, weekNoOf, weekStartOf } from "@/lib/campaign";
import { allCards } from "./forge";
import { ensurePlan, getExceptions, getWindows, weekItemsFor } from "./plan";

/**
 * ICS + Anki export (#103, F-INT-02/03). ICS spreads the next 4 weeks of plan items across the user's real
 * capacity windows and adds the exam day. Anki exports review cards (your takeaways / artifacts / manual cards)
 * — NEVER test-bank questions; the review_cards table only ever holds user-authored content.
 */

const EXPORT_WEEKS = 4;

interface Segment {
  start: number;
  end: number;
}

export async function planIcs(db: Db, userId: string, today: string, tzid: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  (await ensurePlan(tx, userId, today, cfg));
  const windows = (await getWindows(tx, userId));
  const exceptions = (await getExceptions(tx, userId));
  const titles = new Map((await tx.select({ id: chapters.id, title: chapters.title }).from(chapters)).map((c) => [c.id, c.title]));
  const events: IcsEvent[] = [];
  const cur = weekNoOf(today);
  for (let w = cur; w <= Math.min(cur + EXPORT_WEEKS - 1, TOTAL_WEEKS); w++) {
    const start = weekStartOf(w);
    const days = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
    const segments = new Map<string, Segment[]>();
    for (const d of days) {
      const ex = exceptions.find((e) => e.date === d);
      if (ex) {
        segments.set(d, ex.minutes > 0 ? [{ start: 9 * 60, end: Math.min(9 * 60 + ex.minutes, 1440) }] : []);
        continue;
      }
      segments.set(
        d,
        windows
          .filter((win) => win.weekday === weekdaySat(d))
          .map((win) => ({ start: toMin(win.start), end: Math.min(toMin(win.end) < toMin(win.start) ? 1440 : toMin(win.end), 1440) }))
          .filter((s) => s.end > s.start)
          .sort((a, b) => a.start - b.start),
      );
    }
    const cursor = new Map<string, number>(days.map((d) => [d, 0]));
    for (const it of (await weekItemsFor(tx, userId, w))) {
      const title = titles.get(it.chapterId) ?? it.chapterId;
      let remaining = it.plannedMin;
      for (const d of days) {
        if (remaining <= 0) break;
        for (const seg of segments.get(d)!) {
          if (remaining <= 0) break;
          const pos = Math.max(cursor.get(d)!, seg.start);
          if (pos >= seg.end) continue;
          const take = Math.min(remaining, seg.end - pos);
          events.push({
            uid: `${it.id}-${d}-${pos}@the-ascent`,
            date: d,
            startMin: pos,
            endMin: pos + take,
            summary: `Study: ${title}`,
            description: `The Ascent — week ${w}, tier ${it.tier}, ${it.plannedMin} min planned${it.testsTarget ? `, ${it.testsTarget} tests target` : ""}.`,
          });
          remaining -= take;
          cursor.set(d, pos + take);
        }
      }
      if (remaining > 0) {
        events.push({ uid: `${it.id}-overflow@the-ascent`, date: start, startMin: null, endMin: null, summary: `Study plan: ${title} (~${Math.round((remaining / 60) * 10) / 10} h unscheduled)`, description: `Week ${w} windows are full — find a slot for this item or ask Archie to lighten the week.` });
      }
    }
  }
  events.push({ uid: "exam-day@the-ascent", date: EXAM_DATE, startMin: null, endMin: null, summary: "Exam day — finish line", description: "The Ascent campaign ends today. Follow the exam-day playbook on the Final page." });
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.startMin ?? -1) - (b.startMin ?? -1));
  return { filename: "the-ascent-plan.ics", mime: "text/calendar; charset=utf-8", content: buildIcs(events, { nowIso: new Date().toISOString(), tzid }) };
});
}

export async function ankiExport(db: Db, userId: string) {
  const cards = (await allCards(db, userId)).map((c) => ({
    front: c.front,
    back: c.back,
    tags: ["the-ascent", c.refType, ...(c.chapterId ? [c.chapterId] : [])],
  }));
  return { filename: "the-ascent-anki.txt", mime: "text/tab-separated-values; charset=utf-8", content: buildAnki(cards, "The Ascent"), count: cards.length };
}