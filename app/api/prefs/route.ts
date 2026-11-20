import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { withUserTransaction } from "@/db/client";
import { api, body } from "@/server/http";
import { nowIso } from "@/lib/ids";

const input = z.object({ theme: z.enum(["night", "cream"]).optional(), locale: z.enum(["en", "fa"]).optional() });

export const PATCH = api(async ({ db, userId, req }) => {
  const b = input.parse(await body(req));
  await withUserTransaction(db, userId, async (tx) => {
    await tx.update(users).set({ ...b, updatedAt: nowIso() }).where(eq(users.id, userId));
  });
  return { ok: true, ...b };
});
