import { requireUser } from "@/server/context";
import { coachView } from "@/server/coach";
import { PageHeader } from "@/ui/components";
import { MascotSlot } from "@/ui/Mascot";
import { CoachChat } from "./CoachChat";

export const metadata = { title: "Archie — Coach" };

/** Archie coach chat + plan negotiator (#102, F-AIX-01/02). Local-first; plan changes only with approval. */
export default async function CoachPage() {
  const { db, userId, today, cfg } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow="F-AIX-01/02 · local-first coach" title="Archie">
        <MascotSlot character="archie" state="thinking" size="xs" enabled={cfg.flags.mascots} />
      </PageHeader>
      <CoachChat data={(await coachView(db, userId, today))} mascots={cfg.flags.mascots} />
    </div>
  );
}