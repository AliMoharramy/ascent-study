import { describe, expect, it } from "vitest";
import { createStableMutationAttempt, mutationAttemptBody, restoreMutationAttempt } from "./studyLogMutation";

describe("study-log mutation attempts", () => {
  it("keeps the original identity and payload when the transport outcome is ambiguous", () => {
    const firstPayload = { topic: "Graph search", sourceText: "A queue visits nearby vertices." };
    const first = createStableMutationAttempt(null, firstPayload, () => "request-key-0001");
    const replay = createStableMutationAttempt(
      first,
      { ...firstPayload, sourceText: "Edited after timeout." },
      () => "request-key-0002",
    );

    expect(replay).toBe(first);
    expect(mutationAttemptBody(replay)).toEqual({ ...firstPayload, clientRequestId: "request-key-0001" });
  });

  it("creates a new identity for a deliberate mutation after the previous one is confirmed", () => {
    const first = createStableMutationAttempt(null, { action: "complete" }, () => "request-key-0001");
    const next = createStableMutationAttempt(null, { action: "complete" }, () => "request-key-0002");

    expect(mutationAttemptBody(first).clientRequestId).toBe("request-key-0001");
    expect(mutationAttemptBody(next).clientRequestId).toBe("request-key-0002");
  });

  it("restores a mutation ID after reload without requiring browser storage to retain its private payload", () => {
    const recovered = restoreMutationAttempt("request-key-recovered", { sourceText: "re-entered by the user" });

    expect(mutationAttemptBody(recovered)).toEqual({
      sourceText: "re-entered by the user",
      clientRequestId: "request-key-recovered",
    });
  });
});
