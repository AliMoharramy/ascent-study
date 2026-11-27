import { describe, expect, it } from "vitest";
import { pgTables } from "./schema";

describe("Drizzle study-log schema", () => {
  it("registers both study-log tables for migrations and database operations", () => {
    const names = Object.keys(pgTables);
    expect(names).toContain("study_logs");
    expect(names).toContain("study_log_reviews");
    expect(names).toHaveLength(72);
  });
});
