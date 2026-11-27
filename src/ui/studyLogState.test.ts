import { describe, expect, it } from "vitest";
import {
  clearStudyLogRecoveryMarker,
  mergeStudyLogSummaries,
  processingStudyLogIds,
  readStudyLogRecoveryMarkers,
  saveStudyLogRecoveryMarker,
  type StudyLogRecoveryMarker,
} from "./studyLogState";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("study-log client recovery state", () => {
  it("survives a component remount with request identity and no study material", () => {
    const storage = new MemoryStorage();
    const markers: StudyLogRecoveryMarker[] = [
      { kind: "submission", clientRequestId: "submit-001" },
      { kind: "retry", clientRequestId: "retry-001", studyLogId: "log-001" },
      {
        kind: "review",
        clientRequestId: "review-001",
        reviewId: "review-id-001",
        action: "snooze",
        dueOn: "2026-11-16",
      },
    ];
    for (const marker of markers) saveStudyLogRecoveryMarker(storage, marker);
    saveStudyLogRecoveryMarker(storage, {
      kind: "submission",
      clientRequestId: "submit-with-extra-runtime-field",
      sourceText: "PRIVATE_SOURCE_MARKER: must never reach browser storage",
    } as unknown as StudyLogRecoveryMarker);

    const remounted = readStudyLogRecoveryMarkers(storage);

    expect(remounted).toEqual([
      ...markers,
      { kind: "submission", clientRequestId: "submit-with-extra-runtime-field" },
    ]);
    expect(storage.getItem("study-log.recovery.v1")).not.toContain("PRIVATE_SOURCE_MARKER");
    expect(storage.getItem("study-log.recovery.v1")).not.toContain("sourceText");
    clearStudyLogRecoveryMarker(storage, "review-001");
    expect(readStudyLogRecoveryMarkers(storage)).toEqual([
      ...markers.slice(0, 2),
      { kind: "submission", clientRequestId: "submit-with-extra-runtime-field" },
    ]);
  });

  it("bounds processing revalidation to records whose analysis lease is still active", () => {
    const summaries = [
      { id: "active-1", status: "processing", analysisStartedAt: "2026-11-14T10:00:00.000Z" },
      { id: "active-2", status: "processing", analysisStartedAt: "2026-11-14T10:01:00.000Z" },
      { id: "terminal", status: "scheduled", analysisStartedAt: "2026-11-14T10:00:00.000Z" },
      { id: "expired", status: "processing", analysisStartedAt: "2026-11-14T09:00:00.000Z" },
      { id: "invalid", status: "processing", analysisStartedAt: null },
    ];

    expect(processingStudyLogIds(summaries, Date.parse("2026-11-14T10:02:00.000Z"), 1)).toEqual(["active-1"]);
  });

  it("prefers newer authoritative summary data over stale server props", () => {
    const stale = [{ id: "log-1", status: "processing", updatedAt: "2026-11-14T10:00:00.000Z" }];
    const fresh = [{ id: "log-1", status: "scheduled", updatedAt: "2026-11-14T10:01:00.000Z" }];

    expect(mergeStudyLogSummaries(stale, fresh)).toEqual(fresh);
    expect(mergeStudyLogSummaries(fresh, stale)).toEqual(fresh);
  });
});
