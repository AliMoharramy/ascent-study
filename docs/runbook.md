# Runbook — عملیات و بازیابی

> دیتابیس: PostgreSQL (تنها منبع حقیقت). دستورها از پوشهٔ پروژه؛ مقدارهای اتصال را فقط از env بدهید و جایی ننویسید.

## ۱. سلامت
```bash
curl -fsS https://$DOMAIN/healthz       # {"status":"ok"} — فقط زنده‌بودن پروسه؛ دیتابیس را بیدار نمی‌کند
docker compose ps                       # (خودمیزبان) postgres و app: healthy
docker compose logs --tail=100 app      # خطاها؛ لاگ‌ها فقط کد خطا دارند، نه SQL یا اتصال
```
Vercel: لاگ‌های Function و کرون‌ها در داشبورد؛ شکست `/api/cron/backup` یعنی **پشتیبان امشب ساخته نشده** — فوراً بررسی کنید.

## ۲. پشتیبان
- خودکار: کرون روزانه (Vercel) یا ۰۳:۳۰ (`BACKUP_DIR` لوکال/Docker)، نگهداری ۳۰ نسخه، هر نسخه پس از نوشتن اعتبارسنجی می‌شود.
- دستی: **Settings → Back up now**، یا `npm run backup`، یا Export all data.
- کپی خارج از سرویس: `npm run offsite` (نیازمند `OFFSITE_KEY`؛ ۸ نسخه).
- فهرست پشتیبان‌ها: Settings (Vercel: Blob خصوصی رمزشده؛ لوکال: `ls $BACKUP_DIR`).

## ۳. بازیابی (Restore) و drill
همیشه ابتدا یک پشتیبان تازه بگیرید.

**Drill (بی‌خطر؛ مقصد باید خالی باشد):**
```bash
RESTORE_DATABASE_URL="<scratch-direct-url>" OFFSITE_KEY="<key>" \
  npm run restore -- <file> --drill --migrate
```
خروجی `drill passed: N rows verified` یعنی همهٔ جدول‌ها پس از درج دقیقاً با آرشیو برابرند.

**بازیابی واقعی روی دیتابیس موجود:**
```bash
RESTORE_DATABASE_URL="<target-direct-url>" DATABASE_URL="<target-direct-url>" \
  npm run restore -- <file> --replace
```
- کل کار یک تراکنش است؛ هر خطا/اختلاف = هیچ تغییری.
- نشست‌ها بازیابی نمی‌شوند؛ دوباره وارد شوید.
- فایل رمزشده (`.enc`) با `OFFSITE_KEY` همان زمان ساخت باز می‌شود. **بدون کلید، بازیابی ممکن نیست.**
- نسخهٔ اسکیمای آرشیو نباید از دیتابیس مقصد جدیدتر باشد؛ ابتدا `db:migrate` را اجرا کنید (`--migrate`).

## ۴. بازگشت نسخه (Rollback) و Migration
- کد: در Vercel به deploy قبلی برگردید (Promote). Docker: `docker compose up -d` با تگ قبلی.
- Migrationها فقط رو به جلو و سازگار با نسخهٔ قبل‌اند؛ برگرداندن کد بدون برگرداندن دیتابیس امن است.
- مشکل داده: بازیابی از آرشیو (بخش ۳). مشکل اسکیما: migration اصلاحی جدید — فایل اعمال‌شده را هرگز ویرایش نکنید (checksum خطا می‌دهد).
- اجرای migration: `DIRECT_DATABASE_URL=<direct> npm run db:migrate` (یا workflow دستی `Migrate production`). قفل advisory از اجرای هم‌زمان جلوگیری می‌کند؛ اگر `lock_timeout` خورد، یک migration دیگر در حال اجراست — صبر و تکرار کنید.

## ۵. فراموشی رمز / قفل‌شدن ورود
- ۵ تلاش اشتباه ← ۱۵ دقیقه قفل؛ شمارش اتمی است و هم‌زمانی آن را دور نمی‌زند.
- بازنشانی رمز (همهٔ نشست‌ها خارج می‌شوند):
```bash
DATABASE_URL="<url>" ASCENT_NEW_PASSWORD='…' npm run user:reset-password
```

## ۶. Seed دوباره
پس از ویرایش `docs/seed/*.yaml`: `npm run db:seed` یا `POST /api/seed`. Idempotent است، زیر قفل اجرا می‌شود و Tierهای دستی را دست نمی‌زند.

## ۷. مشکلات رایج
| علامت | علت محتمل | راه‌حل |
|---|---|---|
| ۵۰۰ با پیام «Internal error» | خطای دیتابیس (پیام عمداً پنهان است) | لاگ Function: خط `internal_error` یا کد SQLSTATE؛ وضعیت provider و تعداد اتصال |
| `PostgreSQL ... (57014)` | statement_timeout (۳۰ ثانیه) | کوئری سنگین/دیتابیس خوابیده؛ تکرار؛ اگر ادامه داشت بررسی ایندکس |
| `(55P03)` | lock_timeout (۲۵ ثانیه): درخواست دیگری برای همان کاربر قفل را خیلی طولانی نگه داشته | تقریباً همیشه Function Region با منطقهٔ دیتابیس یکی نیست (هر کوئری ~۱۰۰ms) — منطقه را یکی کنید و Redeploy بزنید |
| `(53300)` / مهلت اتصال | سقف اتصال provider | `DB_POOL_MAX` را کم کنید؛ از آدرس pooled استفاده کنید |
| اولین درخواست کند | دیتابیس بعد از بیکاری بیدار می‌شود (در برخی پلن‌ها) | عادی؛ `/healthz` عمداً بیدارش نمی‌کند |
| `Migration … checksum drift` | فایل migration اعمال‌شده ویرایش شده | تغییر را برگردانید؛ اصلاح را در migration جدید بنویسید |
| ورود موفق ولی برگشت به Login | HTTP بدون TLS و کوکی Secure | `COOKIE_SECURE=false` فقط لوکال |
| ساعت روز اشتباه | TZ | `TZ=Asia/Tehran`؛ روز بازی از ۰۴:۰۰ شروع می‌شود (طراحی) |
| نشان «N pending» پایین صفحه | آیتم‌های آفلاین sync نشده | آنلاین شوید → «Sync now»؛ آیتم ردشده Discard دارد (ADR-0015) |
| اعلان نمی‌رسد | کانال خاموش / سقف روزانه / اجازهٔ مرورگر | Settings → Notifications (ADR-0018) |
| Import در Vercel ۴۱۳ می‌دهد | بدنه > ۴٫۵ MB | `npm run restore` |

## ۸. صف آفلاین (issue #107)
- ثبت‌های آفلاین در IndexedDB مرورگر می‌مانند و با بازگشت شبکه flush می‌شوند (`POST /api/sync`). هر آیتم داخل یک تراکنش قفل‌دار بررسی و اعمال می‌شود؛ retry هم‌زمان یک آیتم دوبار اعمال نمی‌شود.
- رویدادهای `sync.replay` شامل applied/duplicates/conflicts/invalid هستند. conflict یعنی نسخهٔ سرور جدیدتر بود و حفظ شد. هیچ حذف خاموشی وجود ندارد.

## ۹. اعلان‌ها (issue #109)
```bash
# تست دستی: Settings → Notifications → Send test
TELEGRAM_BOT_TOKEN=… DATABASE_URL=… npm run telegram:bot
```
اشتراک‌ها در `push_subscriptions` (۴۰۴/۴۱۰ خودکار حذف)؛ ارسال‌ها در رویداد `notify.sent`.

## ۱۰. کیفیت و رگرسیون
```bash
npm run lint && npm run typecheck && npm test      # بدون دیتابیس
TEST_DATABASE_URL=<دیتابیس دورریختنی> npm run test:pg   # یکپارچگی و همروندی روی PostgreSQL
npm run build && npm run perf:budget               # بودجهٔ JS اولیه ≤ ۲۰۰KB gzip
npm run visual -- --base http://localhost:3103
```
`test:pg` فقط روی دیتابیس دورریختنی اجرا شود؛ هر تست یک schema تصادفی می‌سازد و پاک می‌کند، و اگر `TEST_DATABASE_URL` با `DATABASE_URL` یکی باشد متوقف می‌شود.

## ۱۱. Build Freeze (۷ اسفند ۱۴۰۵ → آزمون)
- فقط رفع باگ داده‌گم‌کن/امنیتی + seed با مدرک رسمی + عملیات همین runbook. هر تغییر: ADR کوتاه + تست (ADR-0020).
- ارتقای Next/PostCSS/درایور دیتابیس تا پس از آزمون ممنوع؛ پیش از شروع Freeze یک restore drill موفق انجام و ثبت شود.
