import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { examStructure, testSources } from "@/db/schema";

/** Seed-owned reference data readers: exam structure (#3) and test-bank sources (#13). */

export interface ExamGroup {
  id: string;
  exam_item: number;
  name_fa: string;
  coefficient: number;
  subjects: string[];
  share: number;
}

export interface ExamView {
  yearJalali: number;
  groupCode: number;
  nameFa: string;
  groups: ExamGroup[];
  perSubject: Record<string, number>;
  totalQuestions: number | null;
  durationMin: number | null;
  wrongPenalty: number;
  countsAssumed: boolean;
  sourceUrl: string | null;
  coefficientsSourceUrl: string | null;
  note: string | null;
}

export async function examView(db: Db): Promise<ExamView | null> {
  const r = (await db.select().from(examStructure).orderBy(asc(examStructure.yearJalali)).limit(1))[0];
  if (!r) return null;
  const groups = JSON.parse(r.coefficientsJson) as Omit<ExamGroup, "share">[];
  const sum = groups.reduce((s, g) => s + g.coefficient, 0);
  return {
    yearJalali: r.yearJalali,
    groupCode: r.groupCode,
    nameFa: r.nameFa,
    groups: groups.map((g) => ({ ...g, share: sum ? g.coefficient / sum : 0 })),
    perSubject: JSON.parse(r.perSubjectJson) as Record<string, number>,
    totalQuestions: r.totalQuestions,
    durationMin: r.durationMin,
    wrongPenalty: r.wrongPenalty,
    countsAssumed: r.countsAssumed,
    sourceUrl: r.sourceUrl,
    coefficientsSourceUrl: r.coefficientsSourceUrl,
    note: r.note,
  };
}

export interface TestSourceRow {
  id: string;
  subjectId: string | null;
  title: string;
  kind: string | null;
  approxCount: number | null;
  countDetail: string | null;
  purchased: boolean;
  sourceUrl: string | null;
  note: string | null;
}

export async function listTestSources(db: Db, subjectId?: string): Promise<TestSourceRow[]> {
  return await db.select().from(testSources)
    .where(subjectId ? eq(testSources.subjectId, subjectId) : undefined)
    .orderBy(asc(testSources.subjectId), asc(testSources.id));
}

/** Tests available per subject, counting only purchased sources. */
export async function purchasedTestCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of (await listTestSources(db))) {
    if (!s.purchased || !s.subjectId || s.approxCount === null) continue;
    out[s.subjectId] = (out[s.subjectId] ?? 0) + s.approxCount;
  }
  return out;
}

export async function setTestSourcePurchased(db: Db, id: string, purchased: boolean) {
  const r = (await db.update(testSources).set({ purchased, updatedAt: new Date().toISOString() }).where(eq(testSources.id, id)));
  if ((r.rowCount ?? 0) === 0) throw new Error(`Unknown test source ${id}`);
}