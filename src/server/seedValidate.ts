import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { seedDir, subjectsFileSchema, type SubjectsFile } from "./seed";

/**
 * Seed YAML validation (issue #14): strict schemas for subjects.yaml / mock-exams.yaml plus the
 * invariants from doc 02 §2 (11 subjects, 93 chapters, linear algebra dropped). Every other YAML in
 * docs/seed must parse and may only reference known subject/chapter ids.
 */

export const EXPECTED = { subjects: 11, chapters: 93, mocks: 13 } as const;

const mockSchema = z.object({
  provider: z.string(),
  exams: z
    .array(
      z.object({
        no: z.number().int().min(1),
        date_jalali: z.string().regex(/^\d{4}-\d{2}-\d{2}(\/\d{2})?$/),
        questions: z.number().int().positive(),
        minutes: z.number().int().positive(),
        status: z.string().optional(),
      }),
    )
    .min(1),
});

export interface FileReport {
  file: string;
  errors: string[];
  warnings: string[];
  summary?: string;
}

export function validateSubjects(data: unknown): FileReport {
  const r: FileReport = { file: "subjects.yaml", errors: [], warnings: [] };
  const p = subjectsFileSchema.safeParse(data);
  if (!p.success) {
    r.errors.push(...p.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
    return r;
  }
  const f = p.data;
  const chapters = f.subjects.reduce((s, x) => s + x.chapters.length, 0);
  if (f.subjects.length !== EXPECTED.subjects) r.errors.push(`expected ${EXPECTED.subjects} subjects, found ${f.subjects.length}`);
  if (chapters !== EXPECTED.chapters) r.errors.push(`expected ${EXPECTED.chapters} chapters, found ${chapters}`);
  const la = f.subjects.find((s) => s.id === "linear_algebra");
  if (!la || la.status !== "dropped") r.errors.push("linear_algebra must exist with status: dropped (decision D05)");
  for (const s of f.subjects) for (const c of s.courses ?? []) if (c.estimated && !c.est_hours && !c.duration_min) r.warnings.push(`${c.id}: estimated course without est_hours`);
  const courseIds = f.subjects.flatMap((s) => (s.courses ?? []).map((c) => c.id));
  if (new Set(courseIds).size !== courseIds.length) r.errors.push("duplicate course ids");
  r.summary = `${f.subjects.length} subjects, ${chapters} chapters, ${courseIds.length} courses`;
  return r;
}

export function validateMocks(data: unknown): FileReport {
  const r: FileReport = { file: "mock-exams.yaml", errors: [], warnings: [] };
  const p = mockSchema.safeParse(data);
  if (!p.success) {
    r.errors.push(...p.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
    return r;
  }
  const nos = p.data.exams.map((e) => e.no);
  if (nos.length !== EXPECTED.mocks) r.errors.push(`expected ${EXPECTED.mocks} mock exams, found ${nos.length}`);
  nos.forEach((n, i) => n !== i + 1 && r.errors.push(`exam numbers must be 1..${nos.length} in order (position ${i + 1} has ${n})`));
  r.summary = `${nos.length} mock exams, ${p.data.exams.reduce((s, e) => s + e.questions, 0)} questions total`;
  return r;
}

/** Walks any YAML value and checks `subject`/`subject_id` and `chapter`/`chapter_id` references. */
export function checkReferences(data: unknown, subjects: SubjectsFile, file: string): FileReport {
  const r: FileReport = { file, errors: [], warnings: [] };
  const subjectIds = new Set(subjects.subjects.map((s) => s.id));
  const chapterIds = new Set(subjects.subjects.flatMap((s) => s.chapters.map((c) => `${s.id}-${c.no}`)));
  let refs = 0;
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === "subject" || k === "subject_id") && typeof x === "string") {
        refs += 1;
        if (!subjectIds.has(x)) r.errors.push(`${at}.${k}: unknown subject "${x}"`);
      } else if ((k === "chapter" || k === "chapter_id") && typeof x === "string") {
        refs += 1;
        if (!chapterIds.has(x)) r.errors.push(`${at}.${k}: unknown chapter "${x}"`);
      } else if (k === "chapters" && Array.isArray(x)) {
        for (const [i, id] of x.entries()) {
          if (typeof id !== "string") continue;
          refs += 1;
          if (!chapterIds.has(id)) r.errors.push(`${at}.chapters[${i}]: unknown chapter "${id}"`);
        }
      } else walk(x, `${at}.${k}`);
    }
  };
  walk(data, "$");
  r.summary = `${refs} id reference(s) checked`;
  return r;
}

export function validateSeedDir(dir = seedDir()): { files: FileReport[] } {
  const files: FileReport[] = [];
  const read = (f: string) => YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown;
  let subjects: SubjectsFile | null = null;
  try {
    const raw = read("subjects.yaml");
    const rep = validateSubjects(raw);
    files.push(rep);
    if (!rep.errors.length) subjects = subjectsFileSchema.parse(raw);
  } catch (e) {
    files.push({ file: "subjects.yaml", errors: [(e as Error).message], warnings: [] });
  }
  try {
    files.push(validateMocks(read("mock-exams.yaml")));
  } catch (e) {
    files.push({ file: "mock-exams.yaml", errors: [(e as Error).message], warnings: [] });
  }
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x) && !["subjects.yaml", "mock-exams.yaml"].includes(x)).sort()) {
    try {
      const data = read(f);
      files.push(subjects ? checkReferences(data, subjects, f) : { file: f, errors: [], warnings: ["references not checked (subjects.yaml invalid)"] });
    } catch (e) {
      files.push({ file: f, errors: [`YAML parse error: ${(e as Error).message}`], warnings: [] });
    }
  }
  return { files };
}
