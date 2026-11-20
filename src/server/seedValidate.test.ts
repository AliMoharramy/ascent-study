import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { checkReferences, validateMocks, validateSeedDir, validateSubjects } from "./seedValidate";
import { loadSubjectsFile, seedDir } from "./seed";

describe("seed validation (#14)", () => {
  it("the repository's seed files are valid", () => {
    const r = validateSeedDir();
    const errors = r.files.flatMap((f) => f.errors.map((e) => `${f.file}: ${e}`));
    expect(errors).toEqual([]);
  });

  it("detects wrong chapter counts and a non-dropped linear algebra", () => {
    const raw = YAML.parse(fs.readFileSync(path.join(seedDir(), "subjects.yaml"), "utf8"));
    raw.subjects[0].chapters.pop();
    raw.subjects.find((s: { id: string }) => s.id === "linear_algebra").status = "active";
    const r = validateSubjects(raw);
    expect(r.errors.join("\n")).toMatch(/expected 93 chapters/);
    expect(r.errors.join("\n")).toMatch(/linear_algebra/);
  });

  it("gives clear messages for invalid fields", () => {
    const r = validateSubjects({ meta: {}, subjects: [{ id: "BAD ID" }] });
    expect(r.errors.some((e) => e.startsWith("meta."))).toBe(true);
    expect(r.errors.some((e) => e.includes("subjects.0.id"))).toBe(true);
  });

  it("mock exams must be 13, numbered in order", () => {
    expect(validateMocks({ provider: "x", exams: [{ no: 2, date_jalali: "1405-09-20", questions: 5, minutes: 10 }] }).errors.length).toBe(2);
  });

  it("flags unknown subject/chapter references in other seed files", () => {
    const r = checkReferences({ items: [{ subject: "ai", chapter: "ai-3" }, { subject: "nope", chapter: "ai-99" }] }, loadSubjectsFile(), "x.yaml");
    expect(r.errors).toEqual(['$.items[1].subject: unknown subject "nope"', '$.items[1].chapter: unknown chapter "ai-99"']);
  });
});
