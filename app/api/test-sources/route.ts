import { z } from "zod";
import { api, body } from "@/server/http";
import { listTestSources, setTestSourcePurchased } from "@/server/reference";

export const GET = api(async ({ db, req }) => ({ sources: (await listTestSources(db, new URL(req.url).searchParams.get("subject") ?? undefined)) }));

const patchInput = z.object({ id: z.string().min(1).max(60), purchased: z.boolean() });

export const PATCH = api(async ({ db, req }) => {
  const d = patchInput.parse(await body(req));
  (await setTestSourcePurchased(db, d.id, d.purchased));
  return { ok: true };
});