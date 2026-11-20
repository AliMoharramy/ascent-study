import { afterEach, describe, expect, it, vi } from "vitest";
import { setupTokenMatches, setupTokenRequired } from "./setupToken";

afterEach(() => vi.unstubAllEnvs());

describe("first-run setup token", () => {
  it("is not required (and anything passes) when SETUP_TOKEN is unset or blank", () => {
    vi.stubEnv("SETUP_TOKEN", "");
    expect(setupTokenRequired()).toBe(false);
    expect(setupTokenMatches(undefined)).toBe(true);
    expect(setupTokenMatches("whatever")).toBe(true);
    vi.stubEnv("SETUP_TOKEN", "   ");
    expect(setupTokenRequired()).toBe(false);
  });

  it("requires the exact token when configured", () => {
    vi.stubEnv("SETUP_TOKEN", "correct-horse-battery-staple");
    expect(setupTokenRequired()).toBe(true);
    expect(setupTokenMatches("correct-horse-battery-staple")).toBe(true);
    expect(setupTokenMatches("  correct-horse-battery-staple  ")).toBe(true); // copy/paste whitespace
    expect(setupTokenMatches("correct-horse-battery-stapl")).toBe(false);
    expect(setupTokenMatches("CORRECT-HORSE-BATTERY-STAPLE")).toBe(false);
    expect(setupTokenMatches("")).toBe(false);
    expect(setupTokenMatches(null)).toBe(false);
    expect(setupTokenMatches(undefined)).toBe(false);
  });

  it("does not throw on tokens of any length", () => {
    vi.stubEnv("SETUP_TOKEN", "short");
    expect(setupTokenMatches("x".repeat(10_000))).toBe(false);
  });
});
