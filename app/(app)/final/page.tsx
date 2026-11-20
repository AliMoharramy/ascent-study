import { requireUser } from "@/server/context";
import { finalView } from "@/server/final";
import { PageHeader } from "@/ui/components";
import { MascotSlot } from "@/ui/Mascot";
import { FinalClient } from "./FinalClient";

export const metadata = { title: "Final phase — exam day" };

/** Exam-day playbook + pre-exam sleep plan (#104, F-FIN-02/03). Printable; sleep plan synced with the Sleep Program. */
export default async function FinalPage() {
  const { db, userId, today, cfg } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow="F-FIN-02/03 · the last mile" title="Final phase">
        <MascotSlot character="hero" state="thinking" size="xs" enabled={cfg.flags.mascots} />
      </PageHeader>
      <FinalClient data={(await finalView(db, userId, today))} />
    </div>
  );
}