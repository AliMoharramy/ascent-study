import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { queryOne, withUserTransaction, type Db } from "@/db/client";
import { chapters, courses, examStructure, lessonChapters, lessons, mockExams, prereqs, subjects, testSources } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { nowIso } from "@/lib/ids";

/**
 * Seed import (T-R1-01 / F-DATA-01): `docs/seed/subjects.yaml` → subjects, chapters, courses.
 * Idempotent: re-running updates seed-owned fields (names, titles, status) but never touches user-owned
 * state (chapter tier overrides, course edits, lessons).
 */

const chapterSchema = z.object({ no: z.number().int().positive(), title: z.string().min(1), optional: z.boolean().optional() });

const courseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["teaching", "tips_tests"]),
  instructor: z.string().nullish(),
  platform: z.string().nullish(),
  sessions: z.number().int().nullish(),
  duration_min: z.number().nullish(),
  estimated: z.boolean().optional(),
  est_hours: z.tuple([z.number(), z.number()]).optional(),
});

const subjectSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  name_fa: z.string().min(1),
  name_en: z.string().min(1),
  group: z.enum(["specialized", "math", "english"]),
  status: z.enum(["active", "dropped", "optional"]),
  priority_phase: z.number().int().optional(),
  mode: z.string().optional(),
  notes: z.string().optional(),
  chapters: z.array(chapterSchema).min(1),
  courses: z.array(courseSchema).optional(),
});

export const subjectsFileSchema = z
  .object({
    meta: z.object({
      exam_date_jalali: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      exam_date_gregorian: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      project_start_jalali: z.string(),
      project_start_gregorian: z.string(),
      weeks_total: z.number().int().positive(),
    }).passthrough(),
    subjects: z.array(subjectSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const s of f.subjects) {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate subject id ${s.id}` });
      ids.add(s.id);
      const nos = s.chapters.map((c) => c.no);
      if (new Set(nos).size !== nos.length) ctx.addIssue({ code: "custom", message: `${s.id}: duplicate chapter numbers` });
      nos.forEach((n, i) => n !== i + 1 && ctx.addIssue({ code: "custom", message: `${s.id}: chapters must be numbered 1..n (found ${n} at position ${i + 1})` }));
    }
  });

export type SubjectsFile = z.infer<typeof subjectsFileSchema>;

export function seedDir(): string {
  return process.env.SEED_DIR ?? path.join(process.cwd(), "docs", "seed");
}

export function loadSubjectsFile(file = path.join(seedDir(), "subjects.yaml")): SubjectsFile {
  return subjectsFileSchema.parse(YAML.parse(fs.readFileSync(file, "utf8")));
}

const KIND_LABEL = { teaching: "آموزشی", tips_tests: "نکته و تست" } as const;

export interface SeedReport {
  subjects: number;
  chapters: number;
  activeChapters: number;
  requiredChapters: number;
  courses: number;
  inserted: { subjects: number; chapters: number; courses: number };
}

function readOptional<S extends z.ZodType>(schema: S, file: string): z.output<S> | undefined {
  return fs.existsSync(file) ? schema.parse(YAML.parse(fs.readFileSync(file, "utf8"))) : undefined;
}

/** All seed entry points serialize shared catalogue writes; never acquire the user lock after the seed lock. */
async function withSeedTransaction<T>(db: Db, userId: string | undefined, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(721003)`);
    const seed = async (locked: Db) => {
      await locked.execute(sql`SELECT pg_advisory_xact_lock(721004)`);
      return fn(locked);
    };
    return userId ? withUserTransaction(tx, userId, seed) : seed(tx);
  });
}

export async function importSubjects(db: Db, file: SubjectsFile, opts: { userId?: string; weights?: boolean } = {}): Promise<SeedReport> {
  // Parse before taking database locks. Every write below uses the same supplied transaction.
  const extra = opts.weights === false ? undefined : {
    weights: readOptional(weightsSchema, path.join(seedDir(), "chapter-weights.yaml")),
    lessons: readOptional(coursesFileSchema, path.join(seedDir(), "courses.yaml")),
    prereqs: readOptional(prereqFileSchema, path.join(seedDir(), "prereqs.yaml")),
    mocks: readOptional(mockFileSchema, path.join(seedDir(), "mock-chapter-budget.yaml")),
    exam: readOptional(examFileSchema, path.join(seedDir(), "exam-structure.yaml")),
    sources: readOptional(testSourcesFileSchema, path.join(seedDir(), "test-sources.yaml")),
  };
  return withSeedTransaction(db, opts.userId, async (tx) => {
    const now = nowIso();
    const inserted = { subjects: 0, chapters: 0, courses: 0 };
    for (const [idx, s] of file.subjects.entries()) {
      const exists = (await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, s.id)).limit(1))[0];
      const base = { nameFa: s.name_fa, nameEn: s.name_en, group: s.group, status: s.status, mode: s.mode ?? null, priorityPhase: s.priority_phase ?? null, sort: idx, notes: s.notes ?? null, updatedAt: now };
      if (exists) await tx.update(subjects).set(base).where(eq(subjects.id, s.id));
      else {
        await tx.insert(subjects).values({ id: s.id, ...base });
        inserted.subjects += 1;
      }
      for (const c of s.chapters) {
        const id = `${s.id}-${c.no}`;
        const had = (await tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, id)).limit(1))[0];
        if (had) await tx.update(chapters).set({ title: c.title, optional: !!c.optional, updatedAt: now }).where(eq(chapters.id, id));
        else {
          await tx.insert(chapters).values({ id, subjectId: s.id, no: c.no, title: c.title, optional: !!c.optional, updatedAt: now });
          inserted.chapters += 1;
        }
      }
      for (const c of s.courses ?? []) {
        const had = (await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, c.id)).limit(1))[0];
        if (had) continue; // user-owned after first import
        await tx.insert(courses).values({
          id: c.id,
          userId: opts.userId ?? null,
          subjectId: s.id,
          kind: c.kind,
          title: `${s.name_fa} — ${KIND_LABEL[c.kind]}`,
          instructor: c.instructor && c.instructor !== "?" ? c.instructor : null,
          platform: c.platform ?? null,
          sessions: c.sessions ?? null,
          durationMin: c.duration_min ?? null,
          estHoursMin: c.est_hours?.[0] ?? null,
          estHoursMax: c.est_hours?.[1] ?? null,
          estimated: !!c.estimated,
          speed: c.kind === "teaching" ? 1.5 : 1.75, // C10
          createdAt: now,
          updatedAt: now,
        });
        inserted.courses += 1;
      }
    }
    if (extra) {
      await applyChapterWeights(tx, extra.weights);
      await applyCourseLessons(tx, extra.lessons);
      await applyPrereqs(tx, extra.prereqs);
      await applyMockExams(tx, extra.mocks);
      await applyExamStructure(tx, extra.exam);
      await applyTestSources(tx, extra.sources);
    }
    if (opts.userId) await appendEvent(tx, { userId: opts.userId, type: "seed.imported", payload: { inserted }, source: "system" });
    return { ...await seedCounts(tx), inserted };
  });
}

const weightsSchema = z.object({
  subjects: z.record(
    z.string(),
    z.object({ chapters: z.array(z.object({ no: z.number().int().positive(), eq_weight: z.number().min(0).max(1) }).passthrough()) }).passthrough(),
  ),
});

/**
 * Chapter weights (T-DATA-07): fills `chapters.eq_weight` from seed/chapter-weights.yaml (1397–1405 share of
 * the subject's questions). Optional file; never overwrites a chapter whose tier the user locked.
 */
export async function importChapterWeights(db: Db, file = path.join(seedDir(), "chapter-weights.yaml")): Promise<number> {
  const data = readOptional(weightsSchema, file);
  return withSeedTransaction(db, undefined, (tx) => applyChapterWeights(tx, data));
}

async function applyChapterWeights(tx: Db, w: z.infer<typeof weightsSchema> | undefined): Promise<number> {
  if (!w) return 0;
  let n = 0;
  for (const [subjectId, s] of Object.entries(w.subjects))
    for (const c of s.chapters) {
      const rows = await tx.update(chapters).set({ eqWeight: c.eq_weight })
        .where(and(eq(chapters.id, `${subjectId}-${c.no}`), eq(chapters.tierLocked, false)))
        .returning({ id: chapters.id });
      n += rows.length;
    }
  return n;
}

const coursesFileSchema = z.object({
  courses: z.array(
    z
      .object({
        id: z.string(),
        candidate: z.boolean().optional(),
        lessons: z
          .array(
            z.object({
              n: z.number().int().positive(),
              title: z.string(),
              duration_min: z.number().positive(),
              chapters: z.array(z.string()).optional(),
            }).passthrough(),
          )
          .default([]),
      })
      .passthrough(),
  ),
});

/**
 * Real lesson lists (T-DATA-05): seed/courses.yaml → lessons, only for confirmed (non-candidate) courses that
 * exist and have no lessons yet — never touches lessons the user imported or watched.
 */
export async function importCourseLessons(db: Db, file = path.join(seedDir(), "courses.yaml")): Promise<string[]> {
  const data = readOptional(coursesFileSchema, file);
  return withSeedTransaction(db, undefined, (tx) => applyCourseLessons(tx, data));
}

async function applyCourseLessons(tx: Db, f: z.infer<typeof coursesFileSchema> | undefined): Promise<string[]> {
  if (!f) return [];
  const done: string[] = [];
  const now = nowIso();
  const known = new Set((await tx.select({ id: chapters.id }).from(chapters)).map((c) => c.id));
  const addLinks = async (lessonId: string, chs: string[] | undefined) => {
    for (const ch of chs ?? []) if (known.has(ch)) {
      await tx.insert(lessonChapters).values({ lessonId, chapterId: ch }).onConflictDoNothing();
    }
  };
  for (const c of f.courses) {
    if (c.candidate || c.lessons.length === 0) continue;
    if (!(await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, c.id)).limit(1))[0]) continue;
    const has = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM lessons WHERE course_id = ${c.id}`))?.n ?? 0;
    if (has > 0) {
      // Backfill only known seed lesson links, leaving all user-owned lesson fields untouched.
      for (const l of c.lessons) {
        const lessonId = `${c.id}-l${l.n}`;
        if ((await tx.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.id, lessonId), eq(lessons.courseId, c.id))).limit(1))[0]) {
          await addLinks(lessonId, l.chapters);
        }
      }
      continue;
    }
    for (const l of c.lessons) {
      const lessonId = `${c.id}-l${l.n}`;
      await tx.insert(lessons).values({ id: lessonId, courseId: c.id, no: l.n, title: l.title, durationMin: l.duration_min, status: "todo", createdAt: now, updatedAt: now });
      await addLinks(lessonId, l.chapters);
    }
    const total = c.lessons.reduce((s, l) => s + l.duration_min, 0);
    await tx.update(courses).set({ sessions: c.lessons.length, durationMin: Math.round(total), estimated: false, updatedAt: now }).where(eq(courses.id, c.id));
    done.push(c.id);
  }
  return done;
}

export async function seedCounts(db: Db): Promise<Omit<SeedReport, "inserted">> {
  const n = async (q: ReturnType<typeof sql>) => (await queryOne<{ n: number }>(db, q))?.n ?? 0;
  return {
    subjects: await n(sql`SELECT count(*)::int AS n FROM subjects`),
    chapters: await n(sql`SELECT count(*)::int AS n FROM chapters`),
    /** chapters of non-dropped subjects (incl. optional) */
    activeChapters: await n(sql`SELECT count(*)::int AS n FROM chapters c JOIN subjects s ON s.id = c.subject_id WHERE s.status = 'active'`),
    /** required map nodes: active subjects, optional chapters excluded */
    requiredChapters: await n(sql`SELECT count(*)::int AS n FROM chapters c JOIN subjects s ON s.id = c.subject_id WHERE s.status = 'active' AND c.optional = false`),
    courses: await n(sql`SELECT count(*)::int AS n FROM courses`),
  };
}

const prereqFileSchema = z.object({ prereqs: z.record(z.string(), z.array(z.string())) });

/** Prerequisite graph (docs/seed/prereqs.yaml) → `prereqs`. Idempotent; unknown chapter ids are skipped. */
export async function importPrereqs(db: Db, file = path.join(seedDir(), "prereqs.yaml")): Promise<number> {
  const data = readOptional(prereqFileSchema, file);
  return await withSeedTransaction(db, undefined, (tx) => applyPrereqs(tx, data));
}

async function applyPrereqs(tx: Db, f: z.infer<typeof prereqFileSchema> | undefined): Promise<number> {
  if (!f) return 0;
  const known = new Set((await tx.select({ id: chapters.id }).from(chapters)).map((c) => c.id));
  const rows = Object.entries(f.prereqs).flatMap(([chapterId, reqs]) =>
    reqs.filter((r) => known.has(chapterId) && known.has(r)).map((requiresChapterId) => ({ chapterId, requiresChapterId })));
  if (rows.length === 0) return 0;
  const inserted = await tx.insert(prereqs).values(rows).onConflictDoNothing().returning({ id: prereqs.chapterId });
  return inserted.length;
}

const mockFileSchema = z.object({
  exams: z.array(z.object({ no: z.number().int(), date_jalali: z.string(), questions: z.number().int(), minutes: z.number().int(), subjects: z.record(z.string(), z.object({ questions: z.number() }).passthrough()).optional() }).passthrough()),
});

/** Mock exams + per-subject budget (T-DATA-03) → `mock_exams`. Upserts (seed-owned). */
export async function importMockExams(db: Db, file = path.join(seedDir(), "mock-chapter-budget.yaml")): Promise<number> {
  const data = readOptional(mockFileSchema, file);
  return await withSeedTransaction(db, undefined, (tx) => applyMockExams(tx, data));
}

async function applyMockExams(tx: Db, f: z.infer<typeof mockFileSchema> | undefined): Promise<number> {
  if (!f || f.exams.length === 0) return 0;
  for (const e of f.exams) {
    const row = { dateJalali: e.date_jalali, questions: e.questions, minutes: e.minutes, budgetJson: JSON.stringify(e.subjects ?? {}) };
    await tx.insert(mockExams).values({ no: e.no, ...row }).onConflictDoUpdate({ target: mockExams.no, set: row });
  }
  return f.exams.length;
}

const examFileSchema = z
  .object({
    exam: z.object({ name_fa: z.string(), group_code: z.number().int(), year_jalali: z.number().int(), source_coefficients: z.string().optional() }).passthrough(),
    groups: z.array(z.object({ id: z.string(), exam_item: z.number().int(), name_fa: z.string(), coefficient: z.number(), subjects: z.array(z.string()) })),
    negative_marking: z.object({ wrong_answer_penalty: z.number() }).passthrough(),
    // First scenario is the planning assumption (full mock); the rest are alternatives kept in the YAML only.
    assumed_1406_scenarios: z
      .array(z.object({ id: z.string(), source: z.string().optional(), per_subject: z.record(z.string(), z.number()), total: z.number().int(), duration_min: z.number().int() }).passthrough())
      .min(1),
  })
  .passthrough();

/**
 * Exam structure (T-DATA-02 / issue #3): seed/exam-structure.yaml → `exam_structure` (one row per exam year).
 * Question counts and duration are still an assumption for 1406 — `counts_assumed` stays true until the
 * official booklet is published, so the UI can never present them as official.
 */
export async function importExamStructure(db: Db, file = path.join(seedDir(), "exam-structure.yaml")): Promise<boolean> {
  const data = readOptional(examFileSchema, file);
  return await withSeedTransaction(db, undefined, (tx) => applyExamStructure(tx, data));
}

async function applyExamStructure(tx: Db, f: z.infer<typeof examFileSchema> | undefined): Promise<boolean> {
  if (!f) return false;
  const scenario = f.assumed_1406_scenarios[0]!;
  const row = {
    id: String(f.exam.year_jalali),
    yearJalali: f.exam.year_jalali,
    groupCode: f.exam.group_code,
    nameFa: f.exam.name_fa,
    coefficientsJson: JSON.stringify(f.groups),
    perSubjectJson: JSON.stringify(scenario.per_subject),
    totalQuestions: scenario.total,
    durationMin: scenario.duration_min,
    wrongPenalty: f.negative_marking.wrong_answer_penalty,
    countsAssumed: true,
    sourceUrl: scenario.source ?? null,
    coefficientsSourceUrl: f.exam.source_coefficients ?? null,
    note: `تعداد سؤال و مدت هنوز رسمی نیست؛ سناریوی ${scenario.id}. ساختار قدیم ۱۴۰۵: ۱۱۵ سؤال / ۲۴۰ دقیقه.`,
    updatedAt: nowIso(),
  };
  const { id: _id, ...mutable } = row;
  await tx.insert(examStructure).values(row).onConflictDoUpdate({ target: examStructure.id, set: mutable });
  return true;
}

const testSourcesFileSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      subject_id: z.string(),
      title: z.string(),
      kind: z.string(),
      purchased: z.boolean().optional(),
      approx_count: z.number().int().nullish(),
      count_detail: z.string().nullish(),
      source_url: z.string().nullish(),
      note: z.string().nullish(),
    }),
  ),
});

/**
 * Test-bank sources (Q01 / issue #13): seed/test-sources.yaml → `test_sources`.
 * Counts and titles are seed-owned (upsert); `purchased` is user-owned and only set on first insert,
 * so re-seeding never clobbers a purchase the user toggled in the UI.
 */
export async function importTestSources(db: Db, file = path.join(seedDir(), "test-sources.yaml")): Promise<number> {
  const data = readOptional(testSourcesFileSchema, file);
  return await withSeedTransaction(db, undefined, (tx) => applyTestSources(tx, data));
}

async function applyTestSources(tx: Db, f: z.infer<typeof testSourcesFileSchema> | undefined): Promise<number> {
  if (!f) return 0;
  const now = nowIso();
  let n = 0;
  for (const s of f.sources) {
    const had = (await tx.select({ id: testSources.id }).from(testSources).where(eq(testSources.id, s.id)).limit(1))[0];
    const seedOwned = {
      subjectId: s.subject_id,
      title: s.title,
      kind: s.kind,
      approxCount: s.approx_count ?? null,
      countDetail: s.count_detail ?? null,
      sourceUrl: s.source_url ?? null,
      note: s.note ?? null,
      updatedAt: now,
    };
    if (had) await tx.update(testSources).set(seedOwned).where(eq(testSources.id, s.id));
    else {
      await tx.insert(testSources).values({ id: s.id, userId: null, purchased: !!s.purchased, createdAt: now, ...seedOwned });
      n += 1;
    }
  }
  return n;
}
