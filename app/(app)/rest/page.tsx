import { requireUser } from "@/server/context";
import { programView } from "@/server/rest";
import { wellnessView } from "@/server/wellness";
import { burnoutView } from "@/server/burnout";
import { weekNoOf } from "@/lib/campaign";
import { PageHeader } from "@/ui/components";
import { MascotSlot } from "@/ui/Mascot";
import { RestClient } from "./RestClient";
import { WellnessClient } from "./WellnessClient";
import { BurnoutClient } from "./BurnoutClient";

export const metadata = { title: "Rest & Body" };

/** Rest & Body (S13, #58): sleep program targets vs reality, Hold guards, manual/CSV logging, body steps. */
export default async function RestPage() {
  const { db, userId, today, cfg } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow={`Week ${weekNoOf(today)}`} title="Rest & Body">
        <MascotSlot character="archie" state="cheering" size="xs" enabled={cfg.flags.mascots} />
      </PageHeader>
      <RestClient view={(await programView(db, userId, today))} today={today} week={weekNoOf(today)} />
      <div className="mt-4">
        <WellnessClient data={(await wellnessView(db, userId, today))} />
      </div>
      <div className="mt-4">
        <BurnoutClient data={(await burnoutView(db, userId, today))} />
      </div>
    </div>
  );
}
