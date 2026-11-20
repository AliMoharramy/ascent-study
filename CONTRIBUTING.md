# Contributing to THE ASCENT

Thanks for your interest! THE ASCENT is a gamified study + habit engine, originally built by one person for one exam.
It is now open source so others can run it for themselves, adapt it to their own exams, and improve it.

> **Expectations.** This is a personal-scale project maintained on a best-effort basis. Issues and pull requests are
> welcome, but replies can take a while. Small, focused changes get merged fastest.

## Ground rules

- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Never commit** secrets, connection strings, personal data, exam questions, or copyrighted course/test material
  (see [NOTICE](NOTICE)). Seed-data contributions must say where each fact comes from.
- The app is **single-user by design** (ADR-0021). Multi-user features are out of scope unless discussed first.

## Good first contributions

- Fix a bug (a failing case with a test is the best bug report).
- Improve docs — especially English docs (most design docs under `docs/` are in Persian) and the README.
- Make the exam **configurable** (dates, subjects, coefficients, week grid) — the biggest open item, see
  [`ROADMAP.md`](ROADMAP.md). Please open a discussion/issue before starting, because it touches many modules.
- Translate UI strings or add a locale.
- Add tests (see below), or accessibility improvements.

## Development setup

Requirements: **Node 22**, **Docker** (for the local PostgreSQL), npm, GNU Make (optional).

```bash
git clone <your fork>
cd <repo>
make dev            # starts PostgreSQL in Docker, migrates, seeds, creates a dev user, serves on http://localhost:3100
make login          # prints the URL and the dev username
make demo           # or: a separate database with three weeks of sample data (demo / demo-password-123)
```

Use `make demo` when you work on a page: it has history, streaks and a few cleared chapters, so charts and empty states
are both easy to see. If your change alters how a page looks, regenerate the README gallery with
`npm run screenshots -- --base http://localhost:3100` (needs Chrome or Edge) and include the updated images.

Without `make`: see "Option B — manual npm" in the README.

### Checks (all run in CI — please run them before opening a PR)

```bash
npm run lint
npm run typecheck
npm test                       # unit tests, no database needed
TEST_DATABASE_URL=<disposable db> npm run test:pg   # integration + concurrency tests; `make test-pg` does it for you
npm run build                  # needs no database
npm run smoke -- http://localhost:3100              # page-level smoke test against a RUNNING local instance
```

Important:

- `test:pg` creates and drops random schemas in `TEST_DATABASE_URL`. **Point it only at a disposable database** (the
  Docker one from `make dev` is fine). It refuses to run if the URL equals `DATABASE_URL`.
- `npm run smoke` creates an account and data, so it refuses to talk to anything but a local/private-network host.
- The page smoke test exists because unit tests cannot catch SQL that breaks inside one page. If you add a page, add it
  to `scripts/smoke.mjs`.

## Making a change

1. Open an issue (or comment on an existing one) for anything non-trivial.
2. Branch from `main`; keep the change focused. Unrelated clean-ups belong in separate PRs.
3. Add or update tests. Database behaviour needs a `*.pg.test.ts` test (transactions, idempotency, concurrency).
4. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:` …).
5. Update docs and `CHANGELOG.md` (under "Unreleased") when behaviour changes.
6. Open the PR using the template. CI must be green.

### Database rules (please read before touching `src/db` or `src/server`)

- Migrations are **forward-only** SQL files in `src/db/migrations-pg/`; never edit an applied file (checksums are
  enforced). Make them backward compatible with the previous app version (add, then later remove).
- Migrations run **only** via `npm run db:migrate` on a direct connection — never at build, boot or cold start.
- Every domain operation runs in one transaction through `withUserTransaction` (per-user advisory lock). Writes that can
  be retried must be idempotent through `clientRequestId` (`replayOf`). Never fire concurrent queries on one transaction.
- Raw SQL must be PostgreSQL: booleans are `true/false` (not `0/1`), dates are `DATE`/`timestamptz`, and aggregate results
  are numbers (the driver is configured to parse `bigint`/`numeric`).

## Reviewing & releases

Maintainers squash-merge PRs. Releases follow [Semantic Versioning](https://semver.org/); notable changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## License

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE) (artwork
contributions under CC BY 4.0, see `public/art/LICENSE.md`).
