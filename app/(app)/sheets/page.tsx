import { requireUser } from "@/server/context";
import { sheetsView } from "@/server/sheets";
import { PageHeader } from "@/ui/components";
import { SheetsClient } from "./SheetsClient";

export const metadata = { title: "Cheat-sheets" };

/** Cheat-sheet builder (#113, F-LRN-08): one printable A4 page per subject, built from your own Forge artifacts. */
export default async function SheetsPage() {
  const { db, userId } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow="F-LRN-08 · your own words only" title="Cheat-sheet builder" />
      <SheetsClient initial={(await sheetsView(db, userId))} />
    </div>
  );
}