# AI-assisted study logs and fixed review sequences

## Status

Design approved and implemented in the feature branch for issue #21.

## Goal

Let a user record what they explicitly studied, provide the source material, and ask AI whether that material merits a fixed review sequence. The feature is independent of focus sessions and does not alter Forge card scheduling or subject-level review rounds.

## User experience

- Add a dedicated **Log study** route reachable from the app navigation, command palette, and a Today entry point outside the timer.
- The form captures a required topic, optional course/lesson-video/chapter reference, a study game day defaulting to the user’s current game day, and required notes or transcript. Before each submission or retry, require explicit consent to send the topic and notes/transcript to the configured remote AI provider when AI review planning is enabled; references remain local. Validate private courses against the authenticated owner, permit shared catalog courses, verify that a lesson belongs to its selected course, and verify chapter links against the shared catalog and any lesson-to-chapter link.
- Save the log and its source before calling AI. Show an in-progress state while the decision is being evaluated.
- AI returns one of three outcomes: schedule reviews, no sequence with a reason, or insufficient source material with a request for more detail. Scheduled entries are cloze prompts with exactly one `{{blank}}`; inserting the exact answer into the prompt must reconstruct its source excerpt. Do not call AI if source material is blank or remote-AI consent is absent.
- A scheduled log has four review checkpoints initially due at +3, +7, +14, and +30 game days from the selected study day. The UI displays those dates and keeps the source and status history available.
- Show due and overdue study reviews alongside the existing Forge review experience. Each checkpoint can be completed, snoozed/rescheduled, skipped, or canceled. A snooze changes its current due date while preserving the originally scheduled date and interval.
- The existing reminders surface can include due study reviews when reminders are enabled. Reminder candidates share the user’s configured per-day cap. The Forge queue remains the source of truth and always shows due reviews, even when reminders are off or capped.

## Architecture and data flow

### Persistence

Add two PostgreSQL tables and matching Drizzle schema entries:

- `study_logs`: owner, idempotency key, topic, optional course/lesson-video/chapter references, study game day, source material, AI decision/reason, lifecycle status, explicit-consent timestamp, and timestamps. Enforce a unique `(user_id, client_request_id)` key. A repeated key with the same payload returns the existing log; reusing it with different content is a conflict. A fresh request key creates a separate intentional study session, including for the same topic and day.
- `study_log_reviews`: owner, parent study log, sequence position/offset, source-grounded front/back, original scheduled date, mutable current due date, status, and completion timestamps. Enforce one row per log and interval. Keep this separate from `review_cards`, whose adaptive answer scheduler must not move these fixed checkpoints.

Every study-log and review read and mutation filters by the authenticated owner. Private course references are owner-checked; shared catalog records are validated against the shared catalog. Nested lesson and chapter references are checked for consistency before insertion. Writes to a log decision and its four review rows occur in one transaction. Record domain events for study-log decisions, retry requests, and review actions using the existing event store. Retry and action requests use replay-safe keys; retry events retain a source hash and length rather than duplicating notes.

### Decision lifecycle

1. Persist the submitted log first with a pending analysis status.
2. Claim analysis once per log so retries cannot launch duplicate concurrent AI requests. Replays return the existing state. A stale in-progress attempt can be retried.
3. After explicit consent, send only the user-submitted topic and source material through the existing guarded AI adapter; course, lesson/video, and chapter references stay local. Validate a strict response schema. The prompt explicitly forbids outside facts and requires cloze content reconstructing a source excerpt.
4. For a schedule decision, ignore any model-proposed dates. Calculate all four due dates server-side with date-only game-day arithmetic from `studiedOn`, then atomically persist the decision and four tasks.
5. For a no-sequence or insufficient-material decision, persist its reason and create no review tasks. Insufficient-material logs can be edited and retried.
6. If AI is disabled, capped, unavailable, times out, or returns invalid data, retain the source and mark the log retryable. Do not claim that reviews exist until the database transaction succeeds. Do not use a local model fallback to guess the decision.

The client supplies a request id for creation retries; key reuse with a different normalized payload is rejected. Review actions are also owner-scoped and idempotent where applicable. Only pending review tasks can be completed, snoozed, skipped, or canceled. Reschedule dates must be valid ISO game days later than the current game day.

### HTTP and UI integration

- Add authenticated API operations to create/list logs, inspect a log and its sequence, retry a decision with updated source, and act on an individual review.
- Add `/study-log` with the submission form, retry/edit states, and log history/details.
- Add a distinct study-review list to the Forge review experience; do not pass these items through `answerCard` or the generic interval scheduler.
- Extend reminder generation with due study-review candidates, keeping the existing enable switch and maximum-per-day limit. Use stable reminder keys so repeated page loads do not duplicate reminders.
- No timer or focus-session start, pause, resume, finish, or elapsed-time path calls study-log code.

## Date and content rules

- `studiedOn` is an ISO date in the user’s game-day calendar. The API computes today using the authenticated user’s timezone and rollover hour when the client omits a date.
- Evaluate the rollover against the user’s local wall-clock hour, including daylight-saving transitions; do not subtract a fixed UTC duration before determining the local date.
- Initial dates use fixed offsets `[3, 7, 14, 30]`; server date arithmetic is calendar-day arithmetic and must handle month/year/leap-day boundaries without converting through local midnight.
- The review content and stored source are always tied to the same study log. AI may only create content from submitted material. Missing material is rejected before AI; insufficient material produces a persisted request for more detail with zero tasks.
- All AI response fields, enum values, string lengths, and the expected four checkpoint entries are schema-validated before persistence.

## Failure handling and privacy

- Store source text only in the owner’s study-log record and transmit it to the configured AI provider only after explicit per-submission or per-retry consent.
- If an AI call fails after the initial insert, preserve the log and report a retryable state. If persistence of the decision or tasks fails, the transaction leaves no partial sequence and a second transaction marks it retryable; when the database is still unavailable, the five-minute lease makes it recoverable later.
- The UI must distinguish `processing`, `retryable`, `needs_material`, `no_sequence`, and `scheduled` states and never present an unconfirmed sequence as created.
- Reminder settings affect only reminder creation. They never filter the Forge due queue.

## Verification plan

Use focused domain and PostgreSQL integration coverage for:

- fixed offset calculation across month, year, leap-day, timezone, and game-day rollover boundaries;
- each AI outcome, schema rejection, provider unavailability, and retry after an unsuccessful attempt;
- same-key replay, conflicting payload reuse, and separate intentional same-topic submissions;
- exactly four server-dated review rows and atomicity when persistence fails;
- owner isolation for logs, references, reviews, retry, and all four actions;
- complete, snooze/reschedule, skip, cancel, and repeated actions;
- reminders disabled, enabled, and at the configured cap while due reviews remain visible;
- absence of calls from timer/focus routes and unchanged scheduling of existing Forge cards and review rounds.

## Alternatives considered

1. **Extend `review_cards` with a fixed-sequence mode.** This reuses the queue but couples the new records to the existing card answer scheduler and its interval configuration. Rejected because these checkpoints must keep their explicitly requested dates and statuses.
2. **Reuse `review_rounds`.** This requires fewer records but those rows represent subject-level rounds and cannot hold per-review source-grounded question/answer content or per-task actions. Rejected because it does not match the domain.
3. **Separate study-log and study-review records.** Recommended. This isolates fixed-date behavior and ownership, while allowing the Forge UI and reminder surface to display tasks without changing their existing schedulers.

## Scope boundaries

- No timer-derived study logs or focus-session coupling.
- No change to legacy review-card intervals or subject-level review-round behavior.
- No AI-created facts beyond the submitted source and no local fallback decision.
- No reminder delivery channel beyond the app’s existing reminders surface.
