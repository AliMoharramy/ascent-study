import { STUDY_LOG_ANALYSIS_LEASE_MS } from "@/domain/studyLog";

export const STUDY_LOG_RECOVERY_STORAGE_KEY = "study-log.recovery.v1";
const MAX_RECOVERY_MARKERS = 50;

export type StudyLogRecoveryMarker =
  | { kind: "submission"; clientRequestId: string }
  | { kind: "retry"; clientRequestId: string; studyLogId: string }
  | {
      kind: "review";
      clientRequestId: string;
      reviewId: string;
      action: "complete" | "snooze" | "skip" | "cancel";
      dueOn?: string;
    };

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80;
}

function isMarker(value: unknown): value is StudyLogRecoveryMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Record<string, unknown>;
  if (!isId(marker.clientRequestId)) return false;
  if (marker.kind === "submission") return true;
  if (marker.kind === "retry") return isId(marker.studyLogId);
  if (marker.kind !== "review" || !isId(marker.reviewId)) return false;
  if (!["complete", "snooze", "skip", "cancel"].includes(String(marker.action))) return false;
  return (
    marker.action !== "snooze" ||
    (typeof marker.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(marker.dueOn))
  );
}

function markerOnly(value: StudyLogRecoveryMarker): StudyLogRecoveryMarker {
  if (value.kind === "submission") return { kind: "submission", clientRequestId: value.clientRequestId };
  if (value.kind === "retry")
    return { kind: "retry", clientRequestId: value.clientRequestId, studyLogId: value.studyLogId };
  return {
    kind: "review",
    clientRequestId: value.clientRequestId,
    reviewId: value.reviewId,
    action: value.action,
    ...(value.action === "snooze" ? { dueOn: value.dueOn } : {}),
  };
}

/** Only identities and bounded action metadata belong in browser storage; study text never enters this format. */
export function readStudyLogRecoveryMarkers(storage: RecoveryStorage): StudyLogRecoveryMarker[] {
  try {
    const raw = storage.getItem(STUDY_LOG_RECOVERY_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isMarker).map(markerOnly).slice(-MAX_RECOVERY_MARKERS) : [];
  } catch {
    return [];
  }
}

export function saveStudyLogRecoveryMarker(storage: RecoveryStorage, marker: StudyLogRecoveryMarker): void {
  if (!isMarker(marker)) return;
  const previous = readStudyLogRecoveryMarkers(storage).filter(
    (item) => item.clientRequestId !== marker.clientRequestId,
  );
  try {
    storage.setItem(
      STUDY_LOG_RECOVERY_STORAGE_KEY,
      JSON.stringify([...previous, markerOnly(marker)].slice(-MAX_RECOVERY_MARKERS)),
    );
  } catch {
    // Browser storage may be disabled; the in-memory request attempt remains usable for this mount.
  }
}

export function clearStudyLogRecoveryMarker(storage: RecoveryStorage, clientRequestId: string): void {
  const remaining = readStudyLogRecoveryMarkers(storage).filter(
    (item) => item.clientRequestId !== clientRequestId,
  );
  try {
    if (remaining.length === 0) storage.removeItem(STUDY_LOG_RECOVERY_STORAGE_KEY);
    else storage.setItem(STUDY_LOG_RECOVERY_STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Recovery is best-effort when the browser denies session storage.
  }
}

export function processingStudyLogIds<
  T extends { id: string; status: string; analysisStartedAt: string | null },
>(records: readonly T[], now = Date.now(), max = MAX_RECOVERY_MARKERS, offset = 0): string[] {
  const limit = Math.max(0, Math.min(MAX_RECOVERY_MARKERS, Math.floor(max)));
  const active = records
    .filter((record) => {
      if (record.status !== "processing" || !record.analysisStartedAt) return false;
      const startedAt = Date.parse(record.analysisStartedAt);
      return Number.isFinite(startedAt) && startedAt + STUDY_LOG_ANALYSIS_LEASE_MS > now;
    })
    .map((record) => record.id);
  if (active.length === 0 || limit === 0) return [];
  const start = ((Math.floor(offset) % active.length) + active.length) % active.length;
  return [...active.slice(start), ...active.slice(0, start)].slice(0, limit);
}

export function mergeStudyLogSummaries<T extends { id: string; updatedAt: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = merged.get(item.id);
    const existingAt = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
    const incomingAt = Date.parse(item.updatedAt);
    if (
      !existing ||
      !Number.isFinite(existingAt) ||
      (Number.isFinite(incomingAt) && incomingAt >= existingAt)
    )
      merged.set(item.id, item);
  }
  return [...merged.values()];
}
