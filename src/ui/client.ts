"use client";

/** Browser-side API helper: JSON in/out, CSRF header from the readable csrf cookie, stable error messages. */

import { enqueue, outboxEntry, queueableKind } from "./offline";

export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** An absent response or server error can follow a committed write; replay the same logical mutation safely. */
export function isAmbiguousMutationOutcome(error: unknown): boolean {
  if (error instanceof ClientApiError) return error.status === 0 || error.status >= 500;
  return true;
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)ascent_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

const OFFLINE_MESSAGE = "Saved offline — it will sync automatically when you're back online";

export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const kind = method !== "GET" ? queueableKind(url, opts.body) : null;
  // Offline-first for quick logs (#107): park the mutation instead of losing it.
  if (kind && typeof navigator !== "undefined" && !navigator.onLine) {
    await enqueue(outboxEntry(kind, opts.body));
    throw new ClientApiError(0, "offline", OFFLINE_MESSAGE);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf() } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    if (kind && e instanceof TypeError) {
      await enqueue(outboxEntry(kind, opts.body));
      throw new ClientApiError(0, "offline", OFFLINE_MESSAGE);
    }
    throw e;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ClientApiError(res.status, data.error?.code ?? "error", data.error?.message ?? `Request failed (${res.status})`);
  }
  // Feedback bus (doc 08 §1.3): every mutation that returns an XP summary drives XP Pop / Level Up / refresh.
  if (method !== "GET" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ascent:mutated", { detail: data }));
  return data as T;
}

export const requestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
