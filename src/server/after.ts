import { withUserTransaction, type Db } from "@/db/client";
import { xpSummary } from "@/events/projections";
import { updateChapterState } from "./forge";
import { refreshProgress } from "./quests";
import { checkAchievements } from "./shop";

/**
 * Side effects after any logging action: quest tiers, chapter state / Clear rule, achievements.
 * Returns the fresh XP summary so the client can show XP Pop / Level Up (≤ 500 ms feedback).
 */
export async function afterLog(db: Db, userId: string, day: string, opts: { chapterId?: string | null } = {}) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await refreshProgress(tx, userId, day));
  const cleared = opts.chapterId ? (await updateChapterState(tx, userId, opts.chapterId)).cleared : false;
  const ach = (await checkAchievements(tx, userId, day));
  return { xp: (await xpSummary(tx, userId, day)), cleared, achievements: ach.fresh };
});
}
