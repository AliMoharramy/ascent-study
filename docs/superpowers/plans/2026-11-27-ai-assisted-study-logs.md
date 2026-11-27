# AI-Assisted Study Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issue #21: owner-scoped study logs, source-grounded AI review decisions, four fixed-date review tasks, review actions, and capped reminders, independent of focus sessions.

**Architecture:** Add separate `study_logs` and `study_log_reviews` tables and a pure domain module for validation and calendar-day offsets. A server service saves before calling the existing guarded AI adapter, then atomically records the decision and any four reviews. Add authenticated routes and a dedicated submission/history page; surface due reviews in Forge and the existing reminders view without changing legacy schedulers.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod, Drizzle ORM, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-ai-assisted-study-logs-design.md`

## Global Constraints

- Initial dates use fixed offsets `[3, 7, 14, 30]`; server date arithmetic is calendar-day arithmetic and must handle month/year/leap-day boundaries without converting through local midnight.
- Every study-log and review read and mutation filters by the authenticated owner.
- The review content and stored source are always tied to the same study log. AI may only create content from submitted material.
- The existing reminders surface can include due study reviews when reminders are enabled. Reminder candidates share the user’s configured per-day cap. The Forge queue remains the source of truth and always shows due reviews, even when reminders are off or capped.
- No timer or focus-session start, pause, resume, finish, or elapsed-time path calls study-log code.
- Do not change existing review-card intervals or subject-level review-round scheduling.

## Review Focus

- A request key reused with different content must conflict, while a fresh key for the same topic/day creates a new session; pin this in `studyLogs.pg.test.ts`.
- Cross-owner course/lesson/review IDs and inconsistent lesson/chapter pairs must be rejected or hidden; pin this in `studyLogs.pg.test.ts`.
- A user’s timezone and rollover hour determine the default study game day, while offsets remain date-only; pin this in `studyLog.test.ts`.
- Disabled/capped AI, invalid AI JSON, or insufficient source must never create partial reviews and must leave a clear recoverable state; pin this in `studyLogs.pg.test.ts`.
- Disabled reminders and a full reminder cap must never hide due reviews from Forge; pin this in `reminders.pg.test.ts`.

---

### Task 1: Define the study-log domain and persistent schema

**Files:**
- Create: `src/domain/studyLog.ts`
- Test: `src/domain/studyLog.test.ts`
- Test: `src/db/schema.test.ts`
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations-pg/0005_study_logs.up.sql`
- Modify: `src/db/schema.pg.test.ts`

**Interfaces:**
- Produces: `STUDY_REVIEW_OFFSETS` (`readonly [3, 7, 14, 30]`), `studyLogSubmissionSchema`, `studyLogDecisionSchema`, `validateStudyLogDecision(sourceText: string, candidate: unknown)`, `currentStudyGameDay(now: Date, timezone: string, rolloverHour: number): string`, and `reviewDatesForStudyDay(studiedOn: string): { offsetDays: 3 | 7 | 14 | 30; scheduledOn: string }[]`.
- `studyLogSubmissionSchema` trims a topic of 2–160 characters, requires 1–20,000 non-whitespace source characters, validates real `YYYY-MM-DD` dates, and accepts an 8–80 character idempotency key.
- `studyLogDecisionSchema` accepts `schedule` only with exactly four `{ front, back, evidence }` entries; `validateStudyLogDecision` confirms each evidence excerpt occurs in the supplied source after Unicode normalization and whitespace folding. `no_sequence` and `needs_material` require an empty review list and a nonempty reason.

- [x] **Step 1: Write the failing domain tests** for `reviewDatesForStudyDay("2024-02-28")`, expecting `2024-03-02`, `2024-03-06`, `2024-03-13`, and `2024-03-29`; verify `currentStudyGameDay(new Date("2026-11-14T00:30:00Z"), "Asia/Tehran", 4)` is `2026-11-14` and the same instant in `America/Los_Angeles` is `2026-11-13`; also test blank/oversized source, an impossible ISO date, a schedule decision with the wrong number of review prompts, and rejection of evidence missing from source material.
- [x] **Step 2: Run the focused tests and confirm the missing domain contract causes the failure.** Run: `npm test -- src/domain/studyLog.test.ts`. Expected: FAIL because the domain exports do not exist yet.
- [x] **Step 3: Implement the schemas, source-evidence check, and date helpers** in `src/domain/studyLog.ts`, using `gameDay` for the user’s current game day, `addDaysIso` for date-only offsets, and bounded/trimmed fields for topic, source text, prompts, answers, evidence, and reasons.
- [x] **Step 4: Run the focused tests.** Run: `npm test -- src/domain/studyLog.test.ts`. Expected: PASS, including the leap-day dates and strict four-prompt validation.
- [x] **Step 5: Add the two Drizzle tables and migration-parity assertions.** `study_logs` stores owner, request key, topic, optional references, `studied_on`, source, decision/reason, `analysis_status`, `analysis_started_at`, and timestamps; it has unique `(user_id, client_request_id)`. `study_log_reviews` stores owner, log, checkpoint/offset, prompt/answer, `scheduled_on`, mutable `due_on`, status, and timestamps; it has one row per `(study_log_id, offset_days)`. Update the expected application table count in `schema.pg.test.ts` from 70 to 72.
- [x] **Step 6: Apply the migration/schema test.** Run: `npm run test:pg -- src/db/schema.pg.test.ts`. Expected: PASS with `TEST_DATABASE_URL` pointed at a disposable direct PostgreSQL database; otherwise report that the database integration gate is unavailable.
- [x] **Step 7: Commit** the domain, schema, migration, and tests with `feat: add study log persistence`.

### Task 2: Implement the owner-scoped AI and review lifecycle

**Files:**
- Create: `src/server/studyLogs.ts`
- Test: `src/server/studyLogs.pg.test.ts`
- Modify: `src/server/http.ts`

**Interfaces:**
- `submitStudyLog(db, userId, input, today, evaluator?)` persists before evaluation and returns the saved log with its reviews.
- `retryStudyLog(db, userId, logId, sourceText, today, evaluator?)` updates the source and retries only recoverable logs.
- `getStudyLog(db, userId, logId)`, `listStudyLogs(db, userId)`, and `dueStudyLogReviews(db, userId, today)` are owner-scoped.
- `actOnStudyLogReview(db, userId, reviewId, action, today)` supports `complete`, `snooze`, `skip`, and `cancel`; snooze requires a valid future game-day date.
- `StudyLogEvaluator` is injectable in tests and returns an unknown provider candidate or `null` when the guarded AI adapter cannot decide; the service validates the strict schema and verifies every evidence excerpt against the exact submitted source before persistence.

- [x] **Step 1: Write failing PostgreSQL service tests** for a scheduled decision producing exactly four server-dated reviews, no-sequence and insufficient-material decisions producing none, malformed AI output leaving a retryable log, an unavailable AI attempt succeeding after retry, identical-key replay, changed-payload conflict, concurrent same-key requests invoking the evaluator once, distinct same-topic submissions, reference consistency, owner isolation, review actions, stale analysis reclaim after five minutes, and focus lifecycle independence.
- [x] **Step 2: Run the focused tests and confirm expected failures.** Run: `npm run test:pg -- src/server/studyLogs.pg.test.ts`. Expected: FAIL on absent study-log service exports/behavior, using a disposable direct PostgreSQL database.
- [x] **Step 3: Implement the lifecycle in `src/server/studyLogs.ts`.** Validate private/shared course references and lesson/chapter consistency; claim analysis once per log; reclaim `processing` attempts only when `analysis_started_at` is at least five minutes old; call `remoteCall` with only submitted material; leave failed AI calls retryable; write the decision plus exactly four reviews in one `withUserTransaction`; append owner-scoped domain events; and preserve the original review date when snoozing.
- [x] **Step 4: Map `StudyLogConflict` and `StudyLogNotFound`** in `src/server/http.ts` to the existing conflict/not-found response conventions.
- [x] **Step 5: Run the focused PostgreSQL tests.** Expected: all decision outcomes, retries, idempotency, ownership, date behavior, actions, and timer independence pass.
- [x] **Step 6: Commit** the service, error mapping, and tests with `feat: add source-grounded study review planning`.

### Task 3: Add authenticated study-log API routes

**Files:**
- Create: `app/api/study-logs/route.ts`
- Create: `app/api/study-logs/[id]/route.ts`
- Create: `app/api/study-logs/[id]/retry/route.ts`
- Create: `app/api/study-log-reviews/[id]/route.ts`
- Modify: `src/domain/studyLog.ts`
- Test: `src/domain/studyLog.test.ts`

**Interfaces:**
- `GET /api/study-logs` returns recent owner-scoped summaries and review dates; `POST /api/study-logs` creates a log.
- `GET /api/study-logs/[id]` returns one owner-scoped log including stored source and review history.
- `POST /api/study-logs/[id]/retry` accepts updated source material for a recoverable log.
- `POST /api/study-log-reviews/[id]` accepts an action and, for snooze, a replacement ISO game day.

- [x] **Step 1: Add failing input tests** for retry and review-action bodies in `src/domain/studyLog.test.ts`; assert blank source and malformed snooze dates are rejected. Assert that a syntactically valid but non-future snooze date is rejected by the service-level test from Task 2.
- [x] **Step 2: Run `npm test -- src/domain/studyLog.test.ts` and confirm those new input-schema assertions fail.**
- [x] **Step 3: Implement the retry/action schemas and thin route handlers** using `api()` for session, CSRF, rate limits, Zod handling, and owner identity; derive default `today` from `currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour)`.
- [x] **Step 4: Run `npm test -- src/domain/studyLog.test.ts` and `npm run typecheck`.** Expected: route inputs pass validation and the new handlers typecheck.
- [x] **Step 5: Commit** the route handlers and input tests with `feat: expose study log API`.

### Task 4: Build the study-log entry point and history page

**Files:**
- Create: `app/(app)/study-log/page.tsx`
- Create: `app/(app)/study-log/StudyLogClient.tsx`
- Modify: `app/(app)/today/page.tsx`
- Modify: `src/ui/AppNav.tsx`
- Modify: `src/ui/CommandPalette.tsx`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- `StudyLogClient` receives today’s game day, accessible courses/lessons/chapters, and recent log summaries.
- The client creates with `requestId()`, displays processing/retryable/needs-material/no-sequence/scheduled states, and requests detail only when a user opens a log.

- [x] **Step 1: Add a page/API smoke contract** for `/study-log`, `GET /api/study-logs`, study-log creation, and owner-scoped detail retrieval in `scripts/smoke.mjs`; run it against a disposable local instance.
- [x] **Step 2: Implement the server page** to load the authenticated user’s study day, visible course references, and recent study-log summaries.
- [x] **Step 3: Implement the client form and history** with required topic/source fields, optional links and study date, explicit submit feedback, source editing/retry, and displayed server-returned due dates.
- [x] **Step 4: Add `/study-log` to desktop/mobile navigation and the command palette; add a “Log study” entry point to Today outside the timer component.**
- [x] **Step 5: Run the smoke contract, `npm run typecheck`, and `npm run lint -- 'app/(app)/study-log' 'app/(app)/today/page.tsx' src/ui/AppNav.tsx src/ui/CommandPalette.tsx`.** Expected: the page and API return 200, with no type or lint errors.
- [x] **Step 6: Commit** the route, entry point, smoke contract, and history UI with `feat: add study log experience`.

### Task 5: Surface fixed reviews and actions in Forge

**Files:**
- Create: `app/(app)/forge/StudyLogReviews.tsx`
- Modify: `app/(app)/forge/page.tsx`
- Modify: `app/(app)/forge/ForgeClient.tsx`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Forge receives `dueStudyLogReviews(db, userId, today)` separately from `reviewCards`.
- `StudyLogReviews` displays topic, prompt, answer, original/current due dates, and status; actions call the study-review route and refresh the server view.

- [x] **Step 1: Add a failing Forge smoke assertion** for the study-review heading/empty state on `/forge?tab=review`, then implement the separate study-review section with complete, snooze/reschedule, skip, and cancel controls. Include all pending due and overdue tasks regardless of reminder settings; keep the existing ReviewQueue unchanged.
- [x] **Step 2: Run the focused PostgreSQL service tests, typecheck, and Forge lint.** Expected: fixed review actions pass independently and existing Forge card behavior stays green.
- [x] **Step 3: Run the local smoke test** and confirm `/forge` renders with the study-review section while `/study-log` remains reachable.
- [x] **Step 4: Commit** the Forge integration with `feat: surface study reviews in Forge`.

### Task 6: Add due study reviews to capped reminders

**Files:**
- Modify: `src/server/reminders.ts`
- Test: `src/server/reminders.pg.test.ts`

**Interfaces:**
- Reminder candidates include due study reviews with stable keys derived from review IDs.
- `ensureTodayReminders(db, userId, today)` continues to return the number of newly inserted reminders and honors the existing enabled flag and `maxPerDay` cap.

- [x] **Step 1: Write failing PostgreSQL reminder tests** for enabled reminders including due study reviews, disabled reminders creating none, the per-day cap, repeated page-load idempotency, and due reviews remaining visible through `dueStudyLogReviews` when reminders are disabled or capped.
- [x] **Step 2: Run `npm run test:pg -- src/server/reminders.pg.test.ts` and confirm it fails because study reviews are not reminder candidates yet.**
- [x] **Step 3: Add due review reminder candidates** before routine anchors within the existing enable/cap logic, sorted by current due date and using stable `anchorKey` values and the app’s existing reminder text/surface.
- [x] **Step 4: Run the reminder and study-log PostgreSQL tests.** Expected: cap/disabled/idempotency behavior passes without filtering the Forge queue.
- [x] **Step 5: Commit** the reminder service and tests with `feat: include due study reviews in reminders`.

### Task 7: Update feature documentation and run release checks

**Files:**
- Modify: `docs/06-feature-spec.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `GLOSSARY.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document the user-triggered log, fixed review offsets, retry states, and separate scheduler** in the M6 feature list; document the new persistence/service boundary in the architecture map and glossary; add the Unreleased changelog entry.
- [x] **Step 2: Run the full unit suite** with `npm test`. Result: 21 files, 211 tests passed.
- [x] **Step 3: Run database integration coverage** against the disposable local `TEST_DATABASE_URL`. Result: 28 files, 229 tests passed using the local Vitest executable with `vitest.pg.config.ts` and verbose reporting.
- [x] **Step 4: Run `npm run typecheck`, `npm run lint`, and `npm run build`.** Result: all passed.
- [x] **Step 5: Run the local smoke test** on the disposable production build and inspect `git diff --check`; confirm no timer/focus implementation files were changed and review the complete diff for unrelated changes. Result: smoke passed, diff check is clean, and the rendered form enables after topic/source input.
- [x] **Step 6: Commit** docs and any final fixes with `docs: document AI-assisted study reviews` (or a focused fix commit if verification requires one).
- [ ] **Step 7: Push `codex/ai-study-log-review-planner`, open a PR targeting `main` with `Closes #21`, then close issue #21 as explicitly requested.**

### Code-review follow-up: privacy, grounding, and recovery

- [x] Require per-submission and per-retry consent before study topic/source text may reach the configured remote AI provider; persist the consent timestamp and keep course, lesson/video, and chapter references local.
- [x] Require each generated review to contain one cloze marker whose answer reconstructs its exact source excerpt after Unicode and whitespace normalization.
- [x] Give retry and Forge review actions request IDs, event-backed replay protection, same-state idempotency, and a hash-only retry event payload.
- [x] Recover from decision/review persistence failures with a retryable state and expose a retry after a stalled five-minute processing lease.
- [x] Compute study-log defaults from the local wall-clock rollover so daylight-saving transitions cannot shift the selected study day.
- [x] Verify the follow-up against the disposable local PostgreSQL database only: `npm test` (21 files, 213 tests), PostgreSQL schema/study-log/reminder suites (10 + 10 + 3 tests), typecheck, lint, production build, and local smoke.
