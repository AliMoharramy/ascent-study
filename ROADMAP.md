# Roadmap

THE ASCENT started as one person's tool for one exam, and it shows: the engine is solid, but the exam itself (dates,
subjects, week grid, a few product names) is still written into the code and seed files. This page is the honest list of
what would make it useful to *you* — roughly in the order I'd do it. Nothing here is a promise or a deadline; it is a map
for anyone who wants to help.

Items marked **good first issue** are tracked on the [issue board](https://github.com/AliMoharramy/ascent-study/issues)
with a goal, the files to look at and how to check your work.

## 1. Make the exam a configuration (the big one)

Today the sample exam is encoded in `src/lib/campaign.ts` and `docs/seed/*.yaml`. The goal is that a fresh clone can be
pointed at *any* exam without editing TypeScript.

- [ ] Read `EXAM_DATE`, `PROJECT_START`, `TOTAL_WEEKS` from configuration (env first, later a settings screen). *First step, small.*
- [ ] Derive the week grid from the start date instead of the hard-coded `WEEK1_START`.
- [ ] Turn `docs/seed/` into a **seed pack** (one folder per exam: subjects, chapters, weights, mock-exam structure) selected by a
      single setting, with `npm run seed:validate` checking any pack.
- [ ] Move third-party product names that appear in UI labels (for example the mock-exam banks on the Arena page) into the seed pack.
- [ ] A short "bring your own exam" guide with a worked example.

## 2. Language and layout

The UI is Persian (RTL) with English headings and Jalali dates.

- [ ] Pull user-visible strings into message files so a language is a translation, not a code change. **good first issue** (start with the login page).
- [ ] Optional Gregorian calendar and LTR layout.
- [ ] Translate `docs/runbook.md` and the user guide into English. **good first issue**

## 3. Developer experience

- [ ] Validate environment variables once at startup with a clear error message (zod). **good first issue**
- [ ] Extend `scripts/smoke.mjs` to cover more pages and a write path. **good first issue**
- [ ] One-command "reset my demo database" and a CI job that regenerates the screenshots and fails on layout breakage.
- [ ] A Dev Container / Codespaces config so contributors can start without installing Node and Docker.

## 4. Accessibility and polish

- [ ] Keyboard and screen-reader pass on the timer, the map and the habit grid (labels, focus order, reduced-motion). **good first issue**
- [ ] Contrast audit of both themes against WCAG AA with a short report.
- [ ] A calmer first-run experience: explain the baseline week with one screen instead of a banner.

## 5. Ideas (not planned, but I'd love to see them)

Browser extension to capture distractions ("detours"), a local-AI coach, a desktop tray timer, a companion pet, post-exam
"prestige". If one of these excites you, open a discussion before building it so we can shape it together.

---

**How to help:** pick anything above, say so in an issue so two people don't do the same work, and read
[`CONTRIBUTING.md`](CONTRIBUTING.md). Small, finished pull requests are the most welcome kind.
