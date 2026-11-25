"use client";

import { useEffect, useRef, useState } from "react";
import { isFocusBlockDue } from "@/domain/timer";
import type { FocusView } from "@/server/focus";
import { apiFetch } from "@/ui/client";

export interface FocusBlockResult {
  session: FocusView | null;
  blockCompleted: boolean;
  taskAutoCompleted: boolean;
  todayMinutes?: number;
}

/** Requests the server-owned completion once the 25 active-minute boundary is reached. */
export function useFocusBlockCompletion(
  session: FocusView | null,
  elapsedMs: number,
  onCompleted: (result: FocusBlockResult) => void,
  onEndedElsewhere: () => void,
) {
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onCompleted, onEndedElsewhere });
  useEffect(() => {
    callbacks.current = { onCompleted, onEndedElsewhere };
  }, [onCompleted, onEndedElsewhere]);

  const due = !!session && isFocusBlockDue(session.status, elapsedMs);
  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!due || !sessionId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const retry = (delay: number) => {
      timeout = setTimeout(() => void complete(), delay);
    };
    const complete = async () => {
      try {
        const result = await apiFetch<FocusBlockResult>("/api/focus", {
          body: { action: "complete-block", sessionId },
        });
        if (cancelled) return;
        setError(null);
        if (result.blockCompleted) {
          callbacks.current.onCompleted(result);
          return;
        }
        if (result.session?.status === "ended") {
          callbacks.current.onEndedElsewhere();
          return;
        }
        attempts = 0;
        retry(1_000);
      } catch (cause) {
        if (cancelled) return;
        setError((cause as Error).message || "Could not sync the completed focus block");
        const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
        retry(delays[Math.min(attempts++, delays.length - 1)]!);
      }
    };

    void complete();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [due, sessionId, sessionStatus]);

  return { error };
}
