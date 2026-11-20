import { requireUser } from "@/server/context";
import { coreDone, detourLedger, listIdeas } from "@/server/ideas";
import { PageHeader } from "@/ui/components";
import { IdeasClient } from "./IdeasClient";

export const metadata = { title: "Idea Vault" };

/** Idea Vault + Detour Detector (S15, #40): ideas are parked; starting a non-study session before Core shows friction. */
export default async function IdeasPage() {
  const { db, userId, today } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow="Craft · Builder Hour" title="Idea Vault" />
      <IdeasClient ideas={(await listIdeas(db, userId))} coreDone={(await coreDone(db, userId, today))} ledger={(await detourLedger(db, userId, today, 7))} />
    </div>
  );
}
