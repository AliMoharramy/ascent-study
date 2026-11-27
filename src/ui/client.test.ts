import { describe, expect, it } from "vitest";
import { ClientApiError, isAmbiguousMutationOutcome } from "./client";

describe("mutation outcome classification", () => {
  it("treats transport failures and server errors as ambiguous", () => {
    expect(isAmbiguousMutationOutcome(new TypeError("connection lost"))).toBe(true);
    expect(isAmbiguousMutationOutcome(new ClientApiError(0, "offline", "offline"))).toBe(true);
    expect(isAmbiguousMutationOutcome(new ClientApiError(503, "server_error", "server error"))).toBe(true);
  });

  it("treats an explicit client rejection as confirmed", () => {
    expect(isAmbiguousMutationOutcome(new ClientApiError(409, "conflict", "conflict"))).toBe(false);
    expect(isAmbiguousMutationOutcome(new ClientApiError(422, "invalid", "invalid"))).toBe(false);
  });
});
