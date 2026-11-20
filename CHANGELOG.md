# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Open-source preparation: MIT `LICENSE`, `NOTICE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, issue/PR templates,
  Dependabot, CodeQL (public repos), `CODEOWNERS`.
- Optional `SETUP_TOKEN` to protect the first-run account creation on internet-reachable deployments.
- Persian end-user guide (`docs/user-guide-fa.md`) and an English architecture overview (`docs/ARCHITECTURE.md`).

### Changed
- Artwork is licensed separately (CC BY 4.0, `public/art/LICENSE.md`).

### Removed
- Internal project-management notes, issue-creation tooling, third-party design reference screenshots and the design
  conversation archive.

## [0.1.0] — 2026-11-20

First production-ready release ("Database V2").

### Added
- **PostgreSQL** as the single transactional source of truth (Neon/Vercel or self-hosted Docker); forward-only,
  advisory-locked, checksum-verified migrations applied only by `npm run db:migrate`.
- Per-user transactional locking, idempotent writes via `clientRequestId`, atomic first-run setup and login lockout.
- Verified, encrypted backups (private Blob on Vercel), atomic verified restore and a restore drill (`npm run restore`).
- Page-level smoke test (`npm run smoke`) run in CI.
- Plan start date moved to launch day (2026-11-20); `Asia/Tehran` rollover at 04:00.

### Fixed
- Production page errors found on first deployment: boolean-vs-integer SQL on `/today`, monthly review date keys,
  lock timeouts caused by many sequential round trips (documented: Function Region must equal the database region).

### Removed
- SQLite persistence, `better-sqlite3` and the Blob-snapshot database.
