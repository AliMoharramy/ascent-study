export type StableMutationAttempt<T extends Record<string, unknown>> = {
  clientRequestId: string;
  body: Readonly<T>;
};

/** Reuse a frozen logical request after an ambiguous transport result; pass null only for a new mutation. */
export function createStableMutationAttempt<T extends Record<string, unknown>>(
  pending: StableMutationAttempt<T> | null,
  body: T,
  createId: () => string,
): StableMutationAttempt<T> {
  return pending ?? { clientRequestId: createId(), body: Object.freeze({ ...body }) };
}

export function mutationAttemptBody<T extends Record<string, unknown>>(
  attempt: StableMutationAttempt<T>,
): T & { clientRequestId: string } {
  return { ...attempt.body, clientRequestId: attempt.clientRequestId } as T & { clientRequestId: string };
}
