export const FOCUS_KINDS = ["video", "tests", "review", "analysis", "forge", "other"] as const;

export type FocusKind = (typeof FOCUS_KINDS)[number];

export const FOCUS_KIND_OPTIONS: ReadonlyArray<{ id: FocusKind; label: string }> = [
  { id: "video", label: "Video" },
  { id: "tests", label: "Tests" },
  { id: "review", label: "Review" },
  { id: "analysis", label: "Analysis" },
  { id: "forge", label: "Forge" },
  { id: "other", label: "Other" },
];

export function focusKindLabel(kind: FocusKind): string {
  return FOCUS_KIND_OPTIONS.find((option) => option.id === kind)?.label ?? "Other";
}
