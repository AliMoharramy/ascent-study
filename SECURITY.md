# Security Policy

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private reporting: on the repository page go to **Security → Report a vulnerability**. Include:

- what you found and the impact you believe it has,
- steps or a proof of concept to reproduce it,
- the version/commit and how it was deployed.

You can expect an acknowledgement within about a week (this is a best-effort, small-team project) and a fix or an
explanation as soon as practical. Please give us reasonable time to fix the issue before disclosing it publicly; we are
happy to credit you in the release notes.

## What is in scope

Authentication and sessions, CSRF, authorization/data isolation, the first-run setup flow, backup/export/import,
secret handling, SQL injection, XSS, SSRF, and anything that could expose or corrupt a user's study data or credentials.

Out of scope: findings that need a compromised server or browser, missing best-practice headers without a demonstrated
impact, social engineering, denial of service by sheer volume, and issues in third-party services (Vercel, Neon,
Telegram, AI providers).

## Security model (short)

- **Single-user, self-hosted.** Passwords are hashed with Argon2id; sessions are 32 random bytes in an HttpOnly cookie
  (only the SHA-256 is stored); every mutating request needs a CSRF token; 5 wrong sign-ins lock the account for 15 min.
- **First run:** the first visitor of a fresh deployment can create the one account. On any internet-reachable server set
  `SETUP_TOKEN` so strangers cannot claim it (see `.env.example`).
- **Database:** PostgreSQL over verified TLS (plain connections only on private networks); migrations never run in the
  request path; errors reaching clients and logs carry only a short SQLSTATE code, never SQL, parameters or URLs.
- **Backups** are encrypted (AES-256-GCM, key from `OFFSITE_KEY`) and never contain login sessions. Keep the key
  separate from the backups.
- **Secrets** (database URLs, AI/Telegram keys, `CRON_SECRET`, `OFFSITE_KEY`, `SETUP_TOKEN`) live only in environment
  variables. Never commit them; never put production credentials in Preview/Development environments.
- **AI:** by default, only aggregate numbers are sent to a remote model, with daily and monthly caps. Study-log planning is an explicit exception: after per-session consent, the topic and notes/transcript may be sent to the configured provider; course, lesson, and chapter references stay local. The app works fully without AI.
