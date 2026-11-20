# Documentation index

Most long-form design documents are written in Persian (the project's first audience). This page is the English map:
start here, then follow the links.

## Start here

| Document | Language | What it covers |
|---|---|---|
| [`../README.md`](../README.md) | English | What the project is, quick start, configuration, scripts |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | English | Stack, request → transaction → database → backup flow, design rules, test strategy |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | English | Dev setup, checks, database rules, how to open a PR |
| [`../SECURITY.md`](../SECURITY.md) | English | Reporting a vulnerability and the security model |
| [`../NOTICE`](../NOTICE) | English | Third-party content, artwork and trademark notices |

## Running it

| Document | Language | What it covers |
|---|---|---|
| [`launch-guide.md`](launch-guide.md) | Persian | Step-by-step production launch (Neon + Vercel): environment variables, migration, Blob, first run |
| [`deploy.md`](deploy.md) | Persian | Deployment reference: architecture decisions, environment table, release process, rollback policy, backup and restore drill |
| [`runbook.md`](runbook.md) | Persian | Operations: health, backups, restore, rollback, password reset, common problems |
| [`user-guide-fa.md`](user-guide-fa.md) | Persian | Complete end-user guide: every page, habits, penalties, shortcuts |

## Design and decisions

| Document | What it covers |
|---|---|
| [`adr.md`](adr.md) | Architecture decision records. **ADR-0023** explains the PostgreSQL / transaction design |
| `01` … `13` (`docs/0*-*.md`, `docs/1*-*.md`) | Vision, domain and data, capacity and triage, game design, habit engine, feature spec, architecture and data model, UI/UX, implementation plan, decisions and open items, gamification analysis, UI style, idea backlog |
| [`seed/`](seed) | Reference data loaded by `npm run db:seed` (see `NOTICE` for third-party content) |
| [`research/`](research) | Notes on where the reference data came from |

## Where to look for what

- *How do transactions and idempotency work?* → `ARCHITECTURE.md`, then ADR-0023 and `src/db/client.ts`.
- *How do I add a migration?* → `CONTRIBUTING.md` ("Database rules") and `src/db/migrations-pg/`.
- *How do I run it for another exam?* → README, section "Adapting it to another exam".
- *Something broke in production* → `runbook.md` (error codes are SQLSTATE values such as `55P03`).
