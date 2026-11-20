import { withUserTransaction, type Db } from "@/db/client";
import { appendEvent } from "@/events/store";
import { nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";

export interface DesignApproval {
  approvedAt: string;
  reference: string;
  screens: string[];
  themes: string[];
  note?: string;
}

const KEY = "design.approval";

/** Interactive mockup approval (T-R2-13). Stored in KV and mirrored as a `design.approved` event. */
export async function getDesignApproval(db: Db, userId: string): Promise<DesignApproval | null> {
  return (await getKv<DesignApproval | null>(db, userId, KEY, null));
}

export async function approveDesign(db: Db, userId: string, input: { reference: string; screens: string[]; themes: string[]; note?: string }): Promise<DesignApproval> {
  return await withUserTransaction(db, userId, async (tx) => {
  const record: DesignApproval = { approvedAt: nowIso(), reference: input.reference, screens: input.screens, themes: input.themes, ...(input.note ? { note: input.note } : {}) };
  (await setKv(tx, userId, KEY, record));
  (await appendEvent(tx, { userId, type: "design.approved", payload: { ...record }, source: "app" }));
  return record;
});
}
