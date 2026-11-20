# Architecture overview (for contributors)

This is the short English map of how THE ASCENT works. The long-form design documents under `docs/` (Persian) go deeper;
decisions and their reasons are recorded in [`adr.md`](adr.md) — start with ADR-0023 (Database V2).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router, React 19, TypeScript strict), server components + route handlers |
| Database | **PostgreSQL 17** via Drizzle ORM and `node-postgres` — the single source of truth in every environment |
| Auth | One user; Argon2id passwords; random session token in an HttpOnly cookie (SHA-256 stored); CSRF header on writes |
| Hosting | Vercel Functions + Neon (pooled runtime URL, direct URL for tools), or Docker Compose (`selfhost` profile) |
| Jobs | Vercel cron → `/api/cron/*` (reminders, backup); `node-cron` locally. Boot never touches the database. |
| Tests | Vitest: pure unit tests (no DB), PostgreSQL integration/concurrency suites (isolated schemas), page smoke test |

## Request → transaction → database → backup

```
browser ──HTTP──▶ route handler / server component
                     │  api() wrapper: session, CSRF, rate limit, zod validation, error mapping
                     ▼
            domain service (src/server/*.ts)
                     │  withUserTransaction(db, userId, tx => …)
                     │    BEGIN; set_config(timeouts); pg_advisory_xact_lock(user)   ← serialises one user's writes
                     │    business rules → appendEvent(tx, …) → projectDay(tx, …)    ← event + ledgers commit atomically
                     ▼
              PostgreSQL (source of truth)
                     │
        nightly cron / “Back up now” / npm run backup
                     ▼
   consistent snapshot (REPEATABLE READ, read-only) → gzip JSON archive with per-table SHA-256
                     → AES-256-GCM (OFFSITE_KEY) → private Blob / local folder → verified read-back
```

## Key design rules

1. **Event sourcing.** Every mutation appends to the `events` table; XP / score / gold / gems ledgers are *projections*
   that can be rebuilt (`replayAll`) and compared (`npm run replay`). Projections run in the same transaction as the event.
2. **One transaction per domain operation**, taken through `withUserTransaction` (`src/db/client.ts`). It holds a
   per-user advisory lock, so two requests for the same user never interleave a read-modify-write. Nested calls only open
   a savepoint (the lock is re-entrant), which keeps partial rollback working.
3. **Idempotent writes.** Retryable operations carry a `clientRequestId`. Inside the transaction, `replayOf` returns the
   original result for a retry and rejects the same key with different input (HTTP 409). The database enforces
   `UNIQUE (user_id, client_request_id)` as the last line of defence.
4. **First-run setup is atomic.** A singleton unique index guarantees one account; `SETUP_TOKEN` optionally guards who may
   create it.
5. **Migrations are explicit.** Forward-only SQL in `src/db/migrations-pg/`, applied by `npm run db:migrate` over a direct
   connection with a session advisory lock and checksum verification. They never run at build, boot or cold start, so
   concurrent deployments cannot race.
6. **Errors never leak.** Database errors are reduced to a short SQLSTATE code (`safePgError`); clients get a generic
   message; logs contain the code only.
7. **PostgreSQL SQL only.** Booleans are booleans, dates are `DATE`, timestamps are `timestamptz` (mapped to ISO strings),
   `bigint`/`numeric` results are parsed to numbers. Raw SQL lives next to the module that owns it.

## Where things live

| Path | What |
|---|---|
| `app/` | Pages (`(app)/…`), API routes (`api/…`), `login`, `onboarding`, `healthz` |
| `src/server/` | Domain services (auth, focus, tests, habits, quests, plan, reviews, backup, …) |
| `src/domain/` | Pure game/engine logic (XP, score, planner, triage, habits, exam) — no database, easy to test |
| `src/events/` | Event store, projections and replay |
| `src/db/` | Schema (`schema.ts`), client + transactions, migrator, `migrations-pg/`, test harness |
| `src/config/` | Game configuration schema/defaults (editable and versioned in Settings) |
| `docs/seed/` | Reference data (subjects, chapters, coefficients, mock exams) loaded by `npm run db:seed` |
| `scripts/` | Operator tools: `migrate`, `seed`, `backup`, `restore`, `offsite`, `replay`, `smoke`, `user:*` |

## Testing strategy

- `npm test` — pure logic, runs anywhere in seconds.
- `npm run test:pg` — real PostgreSQL, one random schema per test file: transactions, rollback, idempotency, concurrent
  writers, migrations, backup/restore round trips.
- `npm run smoke` — opens every page and the main APIs of a running instance (catches SQL that only breaks inside a page).
- CI additionally builds without database credentials, enforces the JS bundle budget and smoke-tests the Docker image.

## Known limitations / roadmap

- The exam (dates, subjects, week grid, copy) is still encoded in code and seed files — the main item for making the
  project reusable. See the README section "Adapting it to another exam".
- UI copy is Persian/English mixed; there is no translation layer yet.
- Single-user by design; the in-memory rate limiter is per server instance.
