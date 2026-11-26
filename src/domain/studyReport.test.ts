import { describe, expect, it } from "vitest";
import {
  formatStudyReport,
  parseStudyPeriod,
  summarizeStudySessions,
  type StudyReportSession,
} from "@/domain/studyReport";
import { routeIntent } from "@/domain/coach";

const period = (text: string, today = "2026-11-20") => parseStudyPeriod(text, today);

const session = (overrides: Partial<StudyReportSession> = {}): StudyReportSession => ({
  id: "session-1",
  gameDay: "2026-11-18",
  startedAt: "2026-11-18T08:00:00.000Z",
  minutes: 90,
  kind: "video",
  subjectId: "math",
  subjectName: "Mathematics",
  chapterId: "algebra",
  chapterTitle: "Algebra",
  taskTitle: "Algebra lesson",
  ...overrides,
});

describe("study report period parsing", () => {
  it("routes study-report questions in English and Persian", () => {
    expect(routeIntent("How much did I study last week?")).toBe("study_report");
    expect(routeIntent("How many hours have I studied in the last 30 days?")).toBe("study_report");
    expect(routeIntent("در هفته گذشته چقدر درس خواندم؟")).toBe("study_report");
  });

  it("defaults an unqualified study request to the current Saturday-based game week", () => {
    expect(period("How much did I study?")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-14", endDate: "2026-11-20", kind: "this_week" },
    });
  });

  it("recognizes relative periods in English and Persian", () => {
    expect(period("today")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-20", endDate: "2026-11-20" },
    });
    expect(period("last week")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-07", endDate: "2026-11-13" },
    });
    expect(period("۷ روز اخیر")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-14", endDate: "2026-11-20" },
    });
    expect(period("این ماه")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-01", endDate: "2026-11-20" },
    });
  });

  it("accepts explicit Gregorian and Jalali dates", () => {
    expect(period("from 2026-11-01 to 2026-11-07")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-01", endDate: "2026-11-07", kind: "custom" },
    });
    expect(period("از ۱۴۰۵/۰۸/۱۰ تا ۱۴۰۵/۰۸/۱۶")).toMatchObject({
      status: "ok",
      period: { startDate: "2026-11-01", endDate: "2026-11-07", kind: "custom" },
    });
  });

  it("rejects invalid or reversed explicit date ranges", () => {
    expect(period("from 2026-11-08 to 2026-11-01")).toEqual({ status: "invalid" });
    expect(period("from 2026-13-01 to 2026-13-04")).toEqual({ status: "invalid" });
    expect(period("study report for all time")).toEqual({ status: "invalid" });
  });
});

describe("study report summaries", () => {
  it("summarizes focused minutes, active-day average, and study details", () => {
    const report = summarizeStudySessions([
      session(),
      session({
        id: "session-2",
        startedAt: "2026-11-18T10:00:00.000Z",
        minutes: 30,
        kind: "review",
        taskTitle: "Review algebra",
      }),
      session({
        id: "session-3",
        gameDay: "2026-11-20",
        startedAt: "2026-11-20T08:00:00.000Z",
        minutes: 60,
        kind: "tests",
        subjectId: "physics",
        subjectName: "Physics",
        chapterId: null,
        chapterTitle: null,
        taskTitle: "Mechanics test",
      }),
      session({ id: "session-zero", minutes: 0 }),
    ]);

    expect(report.totalMinutes).toBe(180);
    expect(report.sessionCount).toBe(3);
    expect(report.activeDayCount).toBe(2);
    expect(report.averageMinutesPerActiveDay).toBe(90);
    expect(report.bySubject.map((item) => item.label)).toEqual(["Mathematics", "Physics"]);
    expect(report.byChapter[0]).toMatchObject({
      label: "Mathematics › Algebra",
      minutes: 120,
      sessionCount: 2,
    });

    const message = formatStudyReport(
      report,
      {
        kind: "custom",
        startDate: "2026-11-18",
        endDate: "2026-11-20",
        label: "custom period",
      },
      { timeZone: "UTC" },
    );
    expect(message).toContain("3 completed sessions");
    expect(message).toContain("90 min per active day");
    expect(message).toContain("Mathematics");
    expect(message).toContain("Algebra");
    expect(message).toContain("Review algebra");
  });

  it("reports an empty period clearly", () => {
    const report = summarizeStudySessions([]);
    const message = formatStudyReport(report, {
      kind: "today",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
      label: "today",
    });
    expect(message).toContain("No completed focus sessions");
    expect(message).toContain("2026-11-20");
  });
});
