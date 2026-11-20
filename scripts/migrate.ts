// npm run db:migrate — apply pending PostgreSQL migrations (forward-only; see docs/deploy.md §Rollback policy).
// Uses the DIRECT (non-pooled) connection: migrations need session state and a stable advisory lock, so two
// deployments can never apply the same migration twice. Runtime code never runs migrations.
import { migrationUrl, runPgMigrations } from "../src/db/migrate-pg";

const url = migrationUrl();
const result = await runPgMigrations(url);
const target = new URL(url);
// host:port/database only — never the credentials.
console.log(`pg migrate: ${result.applied.length ? result.applied.join(", ") : "nothing to do"} (${target.host}${target.pathname})`);
