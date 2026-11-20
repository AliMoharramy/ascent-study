## What and why

<!-- One or two sentences. Link the issue: "Fixes #123". -->

## How was it tested?

- [ ] `npm run lint` and `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:pg` (database behaviour: transactions, idempotency, concurrency)
- [ ] `npm run smoke` against a local instance (if a page or an API changed)

## Checklist

- [ ] No secrets, connection strings, personal data, exam questions or copyrighted material
- [ ] Migrations (if any) are forward-only and backward compatible; no applied migration file was edited
- [ ] Docs and `CHANGELOG.md` (Unreleased) updated if behaviour changed
