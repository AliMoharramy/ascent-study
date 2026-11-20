# 07 — معماری، مدل داده و موتورها

> کاربر معیار استک را گفت: «سبک‌ترین چیزی که بالا بیاید، ولی UI/UX خیلی خفن»، ساخت توسط AI، سرور شخصی، اول دسکتاپ بعد موبایل. بنابراین **انتخاب فنی زیر تصمیم من است** (نه توافق)، با دلیل و جایگزین.

## 1. رویکردهای بررسی‌شده

| رویکرد | مزیت | عیب | نتیجه |
|---|---|---|---|
| **A. Next.js (TS) + SQLite + Tailwind + Framer Motion** در یک کانتینر | یک فرآیند، بدون سرور DB جدا؛ بهترین پشتیبانی AI/کتابخانه‌های UI/انیمیشن؛ PWA آسان؛ یک زبان (TS) | سنگین‌تر از Svelte (≈ ۱۵۰–۲۵۰MB RAM) | **انتخاب من** |
| B. SvelteKit + SQLite | سبک‌ترین، سریع | اکوسیستم کامپوننت/انیمیشن کوچک‌تر؛ تولید AI کمی مستعد خطا | جایگزین |
| C. PocketBase + SPA (React/Vite) | بک‌اند آماده (auth، admin، realtime) | قوانین بازی پیچیده در JS Hooks؛ جدا شدن منطق؛ تست سخت‌تر | رد (منطق موتورها باید خالص و قابل‌تست باشد) |
| D. Notion/ابزار آماده | شروع سریع | UI «خفن» و بازی غیرممکن؛ قوانین سفارشی نه | رد |

### دلیل انتخاب A
1. موتورهای بازی (XP/Score/Triage/Rival) **توابع خالص TypeScript** هستند و کاملاً تست‌پذیر.
2. SQLite (WAL) برای تک‌کاربره عالی؛ پشتیبان = کپی یک فایل.
3. تیم ساخت (AI) در این استک بیشترین دقت را دارد؛ UI سطح بالا با Tailwind + Radix + Framer Motion/Canvas.
4. امکان رشد: Postgres بعداً با Drizzle بدون تغییر منطق.

## 2. نمای کلی

```
┌─────────────────────────── مرورگر / PWA ───────────────────────────┐
│ React UI (RSC + Client)  ·  Zustand/TanStack Query  ·  SW (Offline)│
└───────────────▲──────────────────────────────────────┬─────────────┘
                │ HTTPS (Caddy)                         │ Push (اختیاری)
┌───────────────┴────────────── سرور (۱ کانتینر) ───────┴─────────────┐
│ Next.js (Route Handlers / Server Actions)                          │
│  ├─ API layer (zod validation, auth, rate limit)                   │
│  ├─ Domain engines (pure TS):  xp · score · quests · planner ·     │
│  │                              triage · rival · sleep · review    │
│  ├─ Event store (append-only)  → projections (read models)         │
│  ├─ Jobs (node-cron): nightly rollover, weekly rebalance, backup   │
│  ├─ AI adapter (OpenAI-compatible, optional)                       │
│  └─ SQLite (better-sqlite3, WAL) via Drizzle ORM                   │
└────────────────────────────────────────────────────────────────────┘
        │ volume: /data/app.db  /data/backups  /data/uploads
```

### استقرار
- Docker Compose: `app` (Node 22 LTS) + `caddy` (HTTPS خودکار).
- حافظه ≤ ۳۰۰MB؛ CPU ناچیز.
- Volume پایدار برای `/data`.
- پشتیبان شبانه: `sqlite3 app.db ".backup /data/backups/app-YYYYMMDD.db"` + نگهداری ۳۰ روز + کپی هفتگی خارج از سرور (rclone به مقصد دلخواه کاربر).
- متغیرها: `.env` (SESSION_SECRET، AI_BASE_URL، AI_KEY، TZ=Asia/Tehran).
- بازیابی: `scripts/restore.sh <file>` ≤ ۱۰ دقیقه.

## 3. ساختار مخزن (پیشنهادی)

```
gamification/
├─ docs/                       # این اسناد + seed + archive
├─ app/                        # Next.js App Router (صفحات)
│  ├─ (auth)/login
│  ├─ today/  plan/  map/  arena/  habits/  forge/  review/  character/
│  ├─ rest-body/  ideas/  codex/  settings/  mentor/
│  └─ api/…
├─ src/
│  ├─ domain/                  # منطق خالص (بدون I/O)
│  │   ├─ xp.ts  score.ts  levels.ts  quests.ts  planner.ts  triage.ts
│  │   ├─ rival.ts  sleep.ts  review.ts  loot.ts  achievements.ts
│  │   └─ __tests__/
│  ├─ db/ (schema.ts, migrations/, seed.ts)
│  ├─ events/ (types.ts, store.ts, projections.ts)
│  ├─ jobs/ (nightly.ts, weekly.ts, backup.ts)
│  ├─ ai/ (adapter.ts, prompts/, guard.ts)
│  ├─ i18n/ (fa.json, en.json, jalali.ts)
│  ├─ ui/ (components, tokens, motion)
│  └─ config/ (defaults.ts, schema.ts)
├─ public/ (icons, fonts (self-host), art/)
├─ scripts/ (restore.sh, import-seed.ts)
└─ Dockerfile, docker-compose.yml, Caddyfile
```

## 4. اصول معماری

1. **Event Sourcing سبک:** هر تغییر مهم یک رویداد immutable (`events`)؛ جدول‌های «projection» (XP، Score، پیشرفت فصل) از آن ساخته می‌شوند. دلیل: قابل‌حسابرسی، قابل‌بازسازی، «چرا؟» برای هر عدد، امکان تغییر قوانین و بازمحاسبه (Replay).
2. **Domain خالص:** `engine(state, event, config) → { newState, derivedEvents }`، بدون I/O → تست آسان.
3. **Config‑driven:** تمام ثابت‌ها از `config_versions`؛ Replay با Config نسخهٔ زمان رویداد یا جدید (انتخاب).
4. **Idempotency:** هر درخواست ثبت `client_request_id` دارد (آفلاین/تکرار).
5. **زمان:** ذخیره UTC، نمایش `Asia/Tehran`، «روز» از ساعت ۰۴:۰۰ شروع می‌شود (Rollover Hour، قابل‌تنظیم) تا فعالیت‌های بعد از نیمه‌شب به روز قبل بروند. شروع هفته = شنبه.
6. **حداقل وابستگی:** Next، React، Drizzle، better‑sqlite3، zod، Tailwind، Radix، Framer Motion، date-fns‑jalali، node-cron، vitest، playwright.

## 5. مدل داده (SQLite)

> نام‌ها `snake_case`. همهٔ جداول: `id (ULID)`, `user_id`, `created_at`, `updated_at` (به‌جز ledger‌ها). نوع‌ها TypeScript/Drizzle هستند.

### 5.1 هسته
```sql
users(id, name, locale, timezone, rollover_hour, created_at)
config_versions(id, user_id, version, json, reason, created_at)         -- تمام ثابت‌ها
events(id, user_id, type, payload_json, occurred_at, client_request_id UNIQUE, config_version, source)
decisions(id, user_id, date, title, body, rationale, alternatives, status)   -- ADR
```

### 5.2 دانش
```sql
subjects(id, slug, name_fa, name_en, group, status, mode, priority_phase, notes)
chapters(id, subject_id, no, title, optional, tier TEXT CHECK(tier IN ('M','S','C')), tier_locked BOOL, eq_weight REAL)
courses(id, subject_id, kind CHECK(kind IN ('teaching','tips_tests')), title, instructor, platform, est_hours, speed REAL)
lessons(id, course_id, no, title, duration_min, status CHECK(status IN ('todo','watching','done')), watched_at)
lesson_chapters(lesson_id, chapter_id)                                   -- چندبه‌چند
chapter_state(chapter_id, a0 REAL, a REAL, net_pct REAL, sessions_cleared INT, cleared_at, last_test_at, due_review_at)
prereqs(chapter_id, requires_chapter_id)
test_sources(id, title, kind, note)                                      -- بانک تست (فقط متادیتا)
```

### 5.3 ثبت فعالیت
```sql
focus_sessions(id, user_id, subject_id, chapter_id, kind CHECK(kind IN ('video','tests','review','analysis','forge','other')),
               started_at, ended_at, minutes, surge BOOL, manual BOOL, idle_pauses INT)
test_logs(id, user_id, session_id, chapter_id, source_id, correct INT, wrong INT, blank INT, choices INT DEFAULT 4,
          net_pct REAL, logged_at, manual BOOL)
error_items(id, user_id, chapter_id, test_log_id, cause CHECK(cause IN ('concept','calc','time','unread','forgot','careless')),
            takeaway TEXT, source_ref TEXT, repeated_count INT, created_at)
review_cards(id, user_id, ref_type, ref_id, front, back, interval_days, ease REAL, due_at, last_result, reps INT)
forge_artifacts(id, user_id, chapter_id, kind, title, body_md, created_at)
daily_checkins(id, user_id, date, energy_morning, energy_noon, energy_night, blocker TEXT, escape_minutes INT,
               escape_kind TEXT, class_attended BOOL, note TEXT)
```

### 5.4 بازی
```sql
quests(id, user_id, date, kind, habit_id, ref_type, ref_id, title, tiers_json, target_tier, status, source)
quest_logs(id, quest_id, tier_done CHECK(tier_done IN ('seed','standard','stretch')), completed_at, minutes, note)
xp_ledger(id, user_id, event_id, amount REAL, reason, rule_key, cap_applied BOOL, occurred_at)       -- هرگز منفی
score_ledger(id, user_id, event_id, amount REAL, reason, rule_key, week_id, occurred_at)             -- می‌تواند منفی
gold_ledger(id, user_id, event_id, amount INT, reason, occurred_at)
shields(id, user_id, earned_at, used_at, used_for_date)
life_events(id, user_id, date, reason)
achievements(id, key, name, rule_json, tier)
user_achievements(user_id, achievement_id, unlocked_at, evidence_event_id)
loot_rolls(id, user_id, date, result, pity_counter)
level_state(user_id, xp_total, level, title)                                                         -- projection
```

### 5.5 برنامه، باس، Rival
```sql
weeks(id, user_id, no, starts_on, ends_on, phase, capacity_h, committed_h, load_ratio, reset_used BOOL)
week_plan_items(id, week_id, chapter_id, lesson_id, planned_min, tier, status)
bosses(id, user_id, kind CHECK(kind IN ('weekly','region','mini_trial','mock','final')), week_id, scheduled_for,
       spec_json, threshold_pct, status, result_pct, defeated BOOL)
mock_exams(id, no, date_jalali, questions, minutes, status)
mock_chapter_budget(mock_id, chapter_id, questions)                                                  -- T-DATA-03
mock_results(id, user_id, mock_id, taken_at, correct, wrong, blank, net_pct, rank_in_site, per_subject_json)
rival_state(user_id, week_id, pace REAL, mp_user REAL, mp_shadow REAL, events_json)
duels(id, user_id, week_id, rounds_json, winner CHECK(winner IN ('user','shadow','draw')), gold_awarded)
```

### 5.6 عادت و ستون‌ها
```sql
habits(id, user_id, pillar, identity, anchor, context_json, tiers_json, metric_json, temptation, env_prep,
       freq_json, difficulty_level, contract_json, status, started_at)
habit_logs(id, habit_id, date, tier_done, value, note)
sleep_logs(id, user_id, date, bed_at, wake_at, minutes, source CHECK(source IN ('manual','csv')))
sleep_program(user_id, start_wake, target_wake, start_bed, target_bed, step_min, current_wake_target, current_bed_target, hold BOOL, hold_reason)
topics(id, user_id, title, why, value, status CHECK(status IN ('backlog','trial','active','archived')), picked_week, gate_decision)
topic_logs(id, topic_id, date, minutes, note)
ideas(id, user_id, text, tags, value, effort, why_now, status CHECK(status IN ('parked','chosen','built','dropped')), created_at)
detours(id, user_id, started_at, minutes, kind, reason, was_prompted BOOL, choice)
builder_hours(id, user_id, week_id, earned_min, used_min, banked_min, note)
people(id, user_id, name, last_contact_at, cadence_days, note)
bond_logs(id, person_id, date, kind, note)
rewards(id, user_id, title, gold_cost, money_cost, enabled)
reward_claims(id, reward_id, claimed_at, month_key)
```

### 5.7 AI
```sql
ai_calls(id, user_id, purpose, model, tokens_in, tokens_out, cost_est, created_at, request_summary, response_ref)
```

## 6. موتورها — مشخصات الگوریتمی

### 6.1 Rollover شبانه (Job 04:00)
1. بستن روز قبل: برای هر Quest وضعیت نهایی (`done/seed/missed`) تعیین؛ اگر `Life Event` یا `Shield` اعمال شده → بدون جریمه.
2. محاسبه جریمه با سقف روزانه → `score_ledger`.
3. اعمال Comeback: اگر دیروز Miss و امروز Core ≥ Seed نشده → ایجاد Comeback Quest.
4. ایجاد مأموریت‌های امروز: Core از Planner، Fixed، Pillars (حداکثر ۵).
5. به‌روزرسانی Consistency/Flame؛ Loot برای روز قبل (اگر Standard).
6. ثبت Event `day.closed` (قابل Replay).

### 6.2 XP Engine
```ts
award(event, state, cfg): XpAward[]
  // time: floor(minutes/5)*1 ، سقف 72/روز
  // tests: 0.6*correct + 0.1*wrong ، سقف 80/روز
  // analysis: 1.0 * count(error_items با cause+takeaway) ، سقف 40
  // study-share: سهم غیردرسی هفتگی ≤ 30% → مازاد به Gold
```
- هر `xp_ledger` شامل `rule_key` و `cap_applied` است تا «چرا؟» قابل‌نمایش باشد.

### 6.3 Score Engine
- پایهٔ SS هفته: مجموع XP درسی هفته + جایزه‌های باس − جریمه‌ها (سقف‌ها).
- در Boss/Arena: `net_pct = (correct − wrong/(choices−1)) / total × 100` (چهارگزینه‌ای: ۱/۳).
- Weekly: `week_close` ← SS نهایی، نمایش.

### 6.4 Triage (سند 03 §6)
- ورودی: `chapters`, `chapter_state.a0`, `Eq`, `H`, پیش‌نیازها، Overrides.
- خروجی: `tier` برای هر فصل، توضیح «چرا؟»؛ ثبت `triage.run` با Config Version.

### 6.5 Planner
```
for week in remaining_weeks:
   cap = capacity(week)               # ضریب تمرکز متحرک × پنجره‌ها
   queue = chapters ordered by (phase_priority, tier M>S>C, prereq order)
   fill(cap, queue) → week_plan_items  # حداکثر مجموع = cap × 0.9 (ذخیره)
today_core(date) = بخشی از week_plan_items با توجه به ظرفیت امروز (پنجره‌ها + Life Event)
```
- Rebalance: بازمحاسبه از امروز؛ عدم انتقال بدهی؛ حذف C.

### 6.6 Rival (سند 04 §7)
- `MP(t)` از برنامه؛ `pace` به‌روزرسانی یکشنبه‌ها؛ دوئل جمعه‌شب پس از Weekly Boss.

### 6.7 Spaced Review (SM‑2 ساده)
- فاصله‌ها: ۱، ۳، ۷، ۱۴، ۳۰ روز؛ جواب «سخت» → برگشت یک پله؛ «غلط» → ریست.
- منابع کارت: خطاهای تحلیل‌شده، «درس‌آموخته» فصل‌ها (Forge).

### 6.8 Sleep Program
- محاسبه `current_*_target` هر یکشنبه؛ Hold طبق قوانین سند 05 §5.1.

### 6.9 Loot و Achievements
- Loot: توزیع وزنی + `pity_counter`؛ Achievements: قوانین JSON روی رویدادها (مثلاً `{type:"streak", metric:"consistency", days:7}`).

## 7. API (REST/Server Actions)

| گروه | مسیرها (نمونه) |
|---|---|
| Auth | `POST /api/auth/login`، `POST /api/auth/logout` |
| Today | `GET /api/today` (Core، Fixed، Pillars، باس بعدی، شمارش معکوس) |
| Log | `POST /api/sessions/start|pause|stop`، `POST /api/tests`، `POST /api/lessons/:id/done`، `POST /api/checkin` |
| Quest | `POST /api/quests/:id/complete {tier}`، `POST /api/quests/:id/shield`، `POST /api/life-events` |
| Plan | `GET /api/plan/week/:no`، `POST /api/plan/rebalance`، `POST /api/triage/run`، `PATCH /api/chapters/:id {tier}` |
| Boss | `GET /api/bosses/next`، `POST /api/bosses/:id/result` |
| Rival | `GET /api/rival/week/:no` |
| Habits | CRUD `/api/habits`، `POST /api/habits/:id/log` |
| Sleep | `POST /api/sleep`، `GET /api/sleep/program` |
| Ideas | `POST /api/ideas`، `GET /api/ideas`، `POST /api/detours` |
| Review | `GET /api/review/due`، `POST /api/review/:id/answer`، `POST /api/weekly-council` |
| Config | `GET/PUT /api/config` |
| Data | `POST /api/import/*`، `GET /api/export` |
| AI | `POST /api/ai/weekly-review` … |
- همهٔ ورودی‌ها با zod؛ خروجی‌ها JSON؛ خطاها کد ثابت.

## 8. امنیت و حریم خصوصی
- تک‌کاربره؛ رمز Argon2id؛ کوکی HttpOnly + SameSite=Lax؛ CSRF token.
- نرخ‌محدودیت روی ورود و AI.
- داده فقط روی سرور کاربر؛ هیچ ردیاب/CDN شخص ثالث (فونت‌ها self‑host).
- AI: فقط خلاصه‌های لازم، قابل خاموش‌شدن؛ لاگ هر فراخوانی؛ کلیدها فقط در محیط سرور.
- Security headers (CSP، HSTS) از Caddy.

## 9. تست و کیفیت
- **Unit (vitest):** موتورهای domain ≥ ۹۰٪؛ جدول سناریوهای سند 04 §12.
- **Property-based:** سقف‌ها (XP ≥ 0، SS ≥ −120/هفته).
- **Integration:** Rollover شبانه روی داده‌ی نمونه ۲۵ هفته.
- **E2E (Playwright):** ۱۰ سناریو: ورود، شروع Surge، ثبت تست، Level Up، Miss+Shield، Comeback، Weekly Boss، Rebalance، Import، Backup/Restore.
- **Visual regression** برای صفحات اصلی (R5).
- **Replay Test:** بازتولید projection از events برابر state ذخیره‌شده.

## 10. مشاهده‌پذیری
- لاگ JSON، `/healthz`، متریک ساده (زمان پاسخ، خطاها)، گزارش روزانهٔ Job (ایمیل/تلگرام اختیاری).

## 11. تصمیم‌های فنی که به عهدهٔ سازنده است
- انتخاب دقیق کتابخانه‌های UI (shadcn/Radix) و موتور رندر نقشه (SVG/Canvas/Pixi).
- طراحی دقیق Event Schema و نسخه‌بندی آن.
- روش همگام‌سازی آفلاین.
- ساختار CI.
