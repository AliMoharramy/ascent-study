import { z } from "zod";
import { api, body } from "@/server/http";
import { approveDesign, getDesignApproval } from "@/server/design";

export const GET = api(async ({ db, userId }) => ({ approval: (await getDesignApproval(db, userId)) }));

const input = z.object({
  action: z.literal("approve"),
  reference: z.string().min(3).max(200).default("docs/12-ui-style-analysis.md"),
  screens: z.array(z.string().min(1)).min(1).max(12).default(["today", "map", "result", "profile"]),
  themes: z.array(z.enum(["night", "cream"])).min(1).max(2).default(["night", "cream"]),
  note: z.string().max(300).optional(),
});

export const POST = api(async ({ db, userId, req }) => {
  const parsed = input.parse(await body(req));
  return { approval: (await approveDesign(db, userId, parsed)) };
});
