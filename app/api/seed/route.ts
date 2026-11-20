import { api } from "@/server/http";
import { importSubjects, loadSubjectsFile, seedCounts } from "@/server/seed";

export const GET = api(async ({ db }) => (await seedCounts(db)));

/** Re-runs the idempotent seed import (after editing docs/seed/subjects.yaml). */
export const POST = api(async ({ db, userId }) => (await importSubjects(db, loadSubjectsFile(), { userId })));
