import { requireUser } from "@/server/context";
import { getDesignApproval } from "@/server/design";
import { PageHeader } from "@/ui/components";
import { MockupsClient } from "./MockupsClient";

export const metadata = { title: "UI mockups" };

/** T-R2-13: interactive Today / Map / Result / Profile mockups in Night + Cream, with recorded approval. */
export default async function MockupsPage() {
  const { db, userId } = await requireUser();
  return (
    <div>
      <PageHeader eyebrow="Design · doc 12 §5–6" title="Interactive mockups" />
      <MockupsClient approval={(await getDesignApproval(db, userId))} />
    </div>
  );
}
