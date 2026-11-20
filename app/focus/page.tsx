import { requireUser } from "@/server/context";
import { openSession, view, minutesForDay } from "@/server/focus";
import { questsForDay } from "@/server/quests";
import { FocusMode } from "./FocusMode";

export const dynamic = "force-dynamic";
export const metadata = { title: "Focus" };

/** Fullscreen focus mode (#49, F-UXD-06, S06): no navigation, one clock. Esc / Finish → back to Today. */
export default async function FocusPage() {
  const { db, userId, today } = await requireUser();
  const open = (await openSession(db, userId));
  const core = (await questsForDay(db, userId, today)).find((q) => q.kind === "core");
  const target = core ? (JSON.parse(core.targetJson) as { standard: number }).standard : 45;
  return <FocusMode initial={open ? view(open) : null} coreTitle={core?.title ?? "Free focus"} chapterId={core?.refType === "chapter" ? core.refId : null} target={target} doneToday={(await minutesForDay(db, userId, today))} />;
}
