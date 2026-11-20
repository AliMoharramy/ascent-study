// npm run demo:seed — fills an EMPTY, local database with three weeks of realistic sample data.
//
// It exists so that anyone can run the app and see it alive (and so the README screenshots can be regenerated with
// `npm run screenshots`). Everything goes through the same service functions the UI uses — no raw SQL — so the numbers
// you see (XP, streaks, Chapter Clears, charts) are produced by the real engine, not faked.
//
// Safety: refuses to run against a non-local database or one that already has an account.
//   npm run db:migrate && npm run db:seed && npm run demo:seed
// Login afterwards:  demo / demo-password-123
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { isPrivateNetworkHost } from "../src/db/pg-connection";
import { chapters, users } from "../src/db/schema";
import { addDaysIso } from "../src/i18n/jalali";
import { gameDay, localToUtc } from "../src/lib/time";
import { afterLog } from "../src/server/after";
import { setupUser } from "../src/server/auth";
import { saveCheckin } from "../src/server/checkins";
import { manualFocus } from "../src/server/focus";
import { logError } from "../src/server/forge";
import { listHabits, logHabit, seedDefaultHabits } from "../src/server/habits";
import { parkIdea } from "../src/server/ideas";
import { closeDay, generateDay, refreshProgress } from "../src/server/quests";
import { logSleep } from "../src/server/rest";
import { completeOnboarding, confirmBaseline, saveNightly } from "../src/server/reviews";
import { importSubjects, loadSubjectsFile } from "../src/server/seed";
import { logTest } from "../src/server/tests";
import { logWellness } from "../src/server/wellness";

const USERNAME = "demo";
const PASSWORD = "demo-password-123";
const DAYS = 21;

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}
if (!isPrivateNetworkHost(url)) {
  console.error(`Refusing to write demo data to a non-local database (${url.hostname}).`);
  process.exit(1);
}

/** Deterministic pseudo-random numbers, so every run (and every screenshot) looks the same. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1405);
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

const db = getDb();
try {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) {
    console.error("This database already has an account. Demo data only goes into an empty database (make a new one).");
    process.exit(1);
  }

  console.log("• reference data + account");
  await importSubjects(db, loadSubjectsFile());
  const { id: userId } = await setupUser(db, { username: USERNAME, name: "Demo Student", password: PASSWORD });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const tz = user!.timezone;
  const rolloverHour = user!.rolloverHour;
  const today = gameDay(new Date(), tz, rolloverHour);
  await seedDefaultHabits(db, userId, addDaysIso(today, -DAYS));
  await completeOnboarding(db, userId, addDaysIso(today, -DAYS));

  // Chapters grouped by subject, in book order.
  const all = await db.select().from(chapters);
  const bySubject = new Map<string, string[]>();
  for (const c of all.filter((c) => !c.optional).sort((a, b) => a.no - b.no)) {
    bySubject.set(c.subjectId, [...(bySubject.get(c.subjectId) ?? []), c.id]);
  }
  const subjects = ["dsa", "discrete", "os", "arch", "toc", "stats", "ai", "logic"].filter((s) => (bySubject.get(s)?.length ?? 0) >= 3);
  const habits = (await listHabits(db, userId)).filter((h) => h.status === "active" || h.status === "trial");

  const takeaways: Record<string, string[]> = {
    concept: ["Amortised cost is about a sequence, not one operation.", "A DFS tree edge and a back edge are different things — draw it before answering.", "Page-table size scales with the address space, not with memory used.", "A regular language can still need a big DFA — don't confuse size with power.", "Normalisation removes redundancy; it does not make queries faster."],
    calc: ["Convert units first (KB vs. KiB) and only then compute.", "Check the sign when subtracting probabilities.", "Count both endpoints: n-1 gaps, n items.", "Cache hit time and miss penalty are not the same quantity."],
    time: ["Skip anything not solved in 90 seconds; come back at the end.", "Spent 6 minutes on one question — set a hard cap.", "Do the easy half first; the hard half goes better when warm."],
    unread: ["Read the whole stem: the word NOT was in the last line.", "The question asked for the minimum, I computed the maximum.", "Underline the quantifier — 'at least one' is not 'exactly one'."],
    forgot: ["Master theorem case 3 needs the regularity condition.", "Bayes: P(A|B) needs the prior, not just the likelihood.", "Deadlock needs all four Coffman conditions — write them down once."],
    careless: ["Marked B but meant C — re-read the option before bubbling.", "Dropped a minus sign in the last step; verify with a number.", "Copied n instead of n² from the previous line."],
  };
  const blockers = ["Phone in the other room worked; the first 20 minutes were still slow.", "Started late because breakfast took too long.", "Noisy morning, moved to the library.", "Low energy after lunch — walked 10 minutes and it helped.", "Got pulled into a side project for an hour."];
  const sparks = ["Finished the graph chapter and it finally clicked.", "Two focused blocks before noon — best day this week.", "Short day, but I still showed up.", "Solved the hard recurrence without looking.", "Quiet review day; errors notebook is getting useful."];
  const wins = ["Did the first block before checking the phone", "Walked in the morning", "Stopped at the planned time", "Cleared a chapter", "Asked for help instead of staring at it"];

  // Chapter plan: the first chapters of a few subjects get studied and tested twice (≥ 2 days apart) → Chapter Clear.
  const study = subjects.map((s) => ({ subjectId: s, chapters: bySubject.get(s)!.slice(0, 4), done: 0 }));

  console.log(`• ${DAYS} days of history`);
  for (let i = DAYS; i >= 1; i--) {
    const day = addDaysIso(today, -i);
    const evening = localToUtc(day, "22:40", tz);
    const nextMorning = localToUtc(addDaysIso(day, 1), "09:00", tz);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 5 = Friday: lighter day
    const intensity = weekday === 5 ? 0.45 : i % 7 === 3 ? 0.6 : 0.85 + rnd() * 0.3; // a believable wobble
    const s = study[(DAYS - i) % study.length]!;
    const chapterId = s.chapters[Math.min(Math.floor(s.done / 2), s.chapters.length - 1)]!;

    await generateDay(db, userId, day);

    // focus blocks
    const slots = [
      { start: "08:30", kind: "video" as const },
      { start: "11:00", kind: "tests" as const },
      { start: "15:30", kind: "review" as const },
      { start: "20:00", kind: "analysis" as const },
    ];
    const n = Math.max(2, Math.round(slots.length * intensity));
    for (const slot of slots.slice(0, n)) {
      await manualFocus(db, userId, { day, start: slot.start, minutes: between(35, 80), kind: slot.kind, subjectId: s.subjectId, chapterId }, { tz, rolloverHour, now: evening });
    }

    // a practice test most days (two per chapter, spaced) — the second one clears the chapter
    if (weekday !== 5 && i % 3 !== 0) {
      const total = between(20, 30);
      const wrong = between(2, 6);
      const blank = between(0, 3);
      const strong = s.done % 2 === 1; // the second attempt at a chapter is better → Chapter Clear
      const w = strong ? Math.max(1, wrong - 2) : wrong;
      await logTest(db, userId, { subjectId: s.subjectId, chapterId, correct: total - w - blank, wrong: w, blank, choices: 4, seconds: total * 70 }, { now: evening, tz, rolloverHour, day });
      s.done += 1;
      await afterLog(db, userId, day, { chapterId });
      const cause = pick(["concept", "calc", "time", "unread", "forgot", "careless"] as const);
      await logError(db, userId, { subjectId: s.subjectId, chapterId, cause, takeaway: pick(takeaways[cause]!) }, day);
    }

    // habits: mostly a streak with the occasional miss
    for (const h of habits) {
      const r = rnd();
      if (r < 0.1 * (1 - intensity + 0.5)) continue; // missed
      const tier = r < 0.55 ? "standard" : r < 0.8 ? "seed" : "stretch";
      await logHabit(db, userId, h.id, day, tier);
    }

    // sleep, check-in, wellness, nightly review
    const wake = `0${between(6, 8)}:${pick(["10", "25", "40", "55"])}`;
    const bed = `${pick(["23", "23", "00"])}:${pick(["05", "20", "40"])}`;
    await logSleep(db, userId, { date: day, bed, wake });
    await saveCheckin(db, userId, { date: day, energyMorning: between(2, 5), energyNoon: between(2, 4), energyNight: between(2, 4), blocker: pick(blockers), escapeMinutes: between(0, 50), escapeKind: pick(["coding", "video", "social", "other"] as const), classAttended: true, wakeAt: wake, bedAt: bed }, { now: evening, tz, rolloverHour });
    await logWellness(db, userId, day, { mood: between(3, 5), energy: between(2, 5), wins: [pick(wins)], winddown: ["Screens off", "Pack the bag"] });
    await saveNightly(db, userId, day, { spark: pick(sparks), envDone: ["Phone in another room", "Desk cleared"], checklist: ["Phone in another room", "Desk cleared", "Tomorrow's first task written"] });

    await refreshProgress(db, userId, day);
    await closeDay(db, userId, day, { now: nextMorning });
  }

  console.log("• today");
  await generateDay(db, userId, today);
  const now = new Date();
  const todayStart = localToUtc(today, "06:30", tz);
  if (todayStart.getTime() + 50 * 60_000 < now.getTime() - 60_000) {
    await manualFocus(db, userId, { day: today, start: "06:30", minutes: 50, kind: "video", subjectId: study[0]!.subjectId, chapterId: study[0]!.chapters[1]! }, { tz, rolloverHour, now });
  }
  for (const h of habits.slice(0, 3)) await logHabit(db, userId, h.id, today, "standard");
  await refreshProgress(db, userId, today);
  await confirmBaseline(db, userId, today); // builds the week-by-week plan from the scouting tests above

  for (const text of ["Write a tiny visualiser for sorting algorithms (after the exam!)", "Try the Pomodoro variant with 50/10", "Re-read the paging chapter's solved examples"]) {
    await parkIdea(db, userId, { text, tags: "later" });
  }

  console.log(`\nDone. Sign in as  ${USERNAME} / ${PASSWORD}`);
} finally {
  await closeDb();
}
