import { describe, expect, it } from "vitest";
import { fogFor } from "./fog";

describe("territory fog (F-GM-09)", () => {
  it("leaves cleared and unplanned chapters clear", () => {
    expect(fogFor({ state: "cleared", plannedWeek: 3, curWeek: 8, comebacks: 0 }).pct).toBe(0);
    expect(fogFor({ state: "fog", plannedWeek: null, curWeek: 8, comebacks: 0 }).pct).toBe(0);
  });

  it("thickens with the number of weeks behind the plan (capped)", () => {
    const one = fogFor({ state: "fog", plannedWeek: 3, curWeek: 4, comebacks: 0 }).pct;
    const three = fogFor({ state: "fog", plannedWeek: 3, curWeek: 6, comebacks: 0 }).pct;
    const ten = fogFor({ state: "fog", plannedWeek: 3, curWeek: 13, comebacks: 0 }).pct;
    expect(one).toBeLessThan(three);
    expect(ten).toBe(0.64); // capped at 3 weeks of growth
  });

  it("Comebacks thin the fog and can lift it completely", () => {
    const none = fogFor({ state: "fog", plannedWeek: 3, curWeek: 4, comebacks: 0 }).pct;
    const one = fogFor({ state: "fog", plannedWeek: 3, curWeek: 4, comebacks: 1 }).pct;
    const three = fogFor({ state: "fog", plannedWeek: 3, curWeek: 4, comebacks: 3 }).pct;
    expect(one).toBeLessThan(none);
    expect(three).toBe(0);
  });

  it("keeps only a light haze over a chapter in progress", () => {
    const fog = fogFor({ state: "fog", plannedWeek: 3, curWeek: 6, comebacks: 0 }).pct;
    const progress = fogFor({ state: "progress", plannedWeek: 3, curWeek: 6, comebacks: 0 }).pct;
    expect(progress).toBeLessThan(fog);
    expect(progress).toBeGreaterThan(0);
  });

  it("never exceeds the readability ceiling", () => {
    expect(fogFor({ state: "fog", plannedWeek: 1, curWeek: 30, comebacks: 0 }).pct).toBeLessThanOrEqual(0.8);
  });
});
