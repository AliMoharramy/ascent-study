import { describe, expect, it } from "vitest";
import { formatMinutes, parseDuration, parseLessonList } from "./lessonParse";

describe("parseDuration", () => {
  it.each([
    ["45:10", 45.167],
    ["1:02:30", 62.5],
    ["۴۵:۰۰", 45],
    ["45 min", 45],
    ["30 دقیقه", 30],
    ["no duration", null],
  ])("%s → %s", (input, out) => expect(parseDuration(input)).toBe(out));
});

describe("parseLessonList (paste/CSV import)", () => {
  it("numbered lines with dash and clock", () => {
    const r = parseLessonList("1. Intro — 12:30\n2. Search algorithms — 1:05:00\n");
    expect(r.errors).toEqual([]);
    expect(r.lessons).toEqual([
      { no: 1, title: "Intro", durationMin: 12.5, line: 1 },
      { no: 2, title: "Search algorithms", durationMin: 65, line: 2 },
    ]);
    expect(r.totalMin).toBe(77.5);
  });

  it("CSV with header", () => {
    const r = parseLessonList("no,title,duration\n1,Trees,45:00\n2,\"Heaps, part 1\",30:00");
    expect(r.lessons.map((l) => [l.no, l.title, l.durationMin])).toEqual([
      [1, "Trees", 45],
      [2, "Heaps, part 1", 30],
    ]);
  });

  it("tab separated (copied from a web table)", () => {
    const r = parseLessonList("Trees\t45:00\nGraphs\t50:00");
    expect(r.lessons.map((l) => l.no)).toEqual([1, 2]);
  });

  it("Persian lines", () => {
    const r = parseLessonList("جلسه ۱ - مفاهیم اولیه (۴۵:۱۰)\nجلسه ۲ - عامل‌ها ۳۰:۰۰");
    expect(r.errors).toEqual([]);
    expect(r.lessons[0]!.no).toBe(1);
    expect(r.lessons[0]!.durationMin).toBeCloseTo(45.167, 3);
    expect(r.lessons[0]!.title).toContain("مفاهیم اولیه");
    expect(r.lessons[1]!.title).toContain("عامل");
  });

  it("reports lines without duration, keeps others", () => {
    const r = parseLessonList("Intro 10:00\nbroken line\nOutro 5:00");
    expect(r.lessons.length).toBe(2);
    expect(r.errors).toEqual([{ line: 2, text: "broken line", message: expect.stringMatching(/no duration/) }]);
  });

  it("100 lessons parse fast (AC: 100 in ≤ 10 s)", () => {
    const text = Array.from({ length: 100 }, (_, i) => `${i + 1}. Lesson ${i + 1} — ${10 + (i % 50)}:00`).join("\n");
    const t0 = performance.now();
    const r = parseLessonList(text);
    expect(r.lessons.length).toBe(100);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("formatMinutes", () => {
    expect(formatMinutes(95.95)).toBe("1:35:57");
    expect(formatMinutes(12.5)).toBe("12:30");
  });
});
