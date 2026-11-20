// npm run db:seed — idempotent import of the shared reference data (docs/seed/*.yaml).
// An explicit operator step: it never runs on a Function cold start, and re-running it is safe.
import { closeDb, getDb } from "../src/db/client";
import { importSubjects, loadSubjectsFile } from "../src/server/seed";

try {
  console.log(await importSubjects(getDb(), loadSubjectsFile()));
} finally {
  await closeDb();
}
