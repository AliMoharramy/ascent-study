# راهنمای راه‌اندازی production — قدم‌به‌قدم (Vercel + Neon)

> تصمیم‌ها: **Neon** (PostgreSQL) · **Vercel Hobby** با آدرس `*.vercel.app` · **Vercel Blob (private)** فقط برای پشتیبان رمزشده · AI و Telegram روشن · نام کاربری: دلخواه شما.
> Supabase استفاده نمی‌شود (دلیل در بخش ۹).
> **هیچ رمز، رشتهٔ اتصال یا توکنی را در چت، Git یا issue نفرستید.** همه را مستقیم در داشبورد Vercel یا PowerShell خودتان وارد کنید.

## ۱. جدول متغیرهای محیطی — کجا اضافه شوند؟

همه فقط در **Vercel → Project → Settings → Environment Variables**، و فقط با تیک **Production** (Preview و Development را تیک نزنید).

| نام | مقدار از کجا | محرمانه؟ |
|---|---|---|
| `DATABASE_URL` | رشتهٔ **pooled** Neon (بخش ۳) | بله |
| `OFFSITE_KEY` | خودتان می‌سازید (بخش ۲) | بله |
| `CRON_SECRET` | خودتان می‌سازید (بخش ۲) | بله |
| `TZ` | `Asia/Tehran` | خیر |
| `AI_BASE_URL` | از فایل `.env.local` همین پروژه (`https://api.arvancloudai.ir/v1`) | خیر |
| `AI_KEY` | از فایل `.env.local` (همان کلید آروان) | **بله** |
| `AI_MODEL` | از فایل `.env.local` (`Gemma-4-31B-IT`) | خیر |
| `AI_TIMEOUT_MS` | `55000` | خیر |
| `TELEGRAM_BOT_TOKEN` | از `@BotFather` (بخش ۶) — **در `.env.local` شما وجود ندارد** | **بله** |

نکته‌ها:
- فایل `.env.local` را باز کنید (`notepad D:\macbook\gamification\.env.local`) و مقدارهای AI را مستقیم از همان‌جا در Vercel کپی کنید؛ آن فایل Git نمی‌شود.
- **این‌ها را در Vercel نگذارید:** `DIRECT_DATABASE_URL`، `TEST_DATABASE_URL`، `RESTORE_DATABASE_URL`، `COOKIE_SECURE`، `DISABLE_JOBS`، `BACKUP_DIR`. (متغیر Blob را خود Vercel هنگام وصل‌کردن Blob می‌سازد.)
- `DIRECT_DATABASE_URL` فقط در PowerShell خودتان و فقط برای migration/restore لازم است.

## ۲. دو مقدار محرمانه را روی رایانهٔ خودتان بسازید

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"   # → CRON_SECRET
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"   # → OFFSITE_KEY
```
هر دو را در مدیر رمز عبور ذخیره کنید. **`OFFSITE_KEY` را گم نکنید؛** بدون آن هیچ پشتیبانی بازیافتنی نیست.

## ۳. Neon — ساخت دیتابیس

1. [neon.com](https://neon.com) → Sign up → **New project**.
2. Name: `ascent` · Postgres: **17** · Region: نزدیک به Functions (پیشنهاد: AWS Frankfurt `eu-central-1`؛ در Vercel هم همان منطقه را انتخاب می‌کنید، بخش ۵).
3. **Connect** → کلید **Connection pooling = ON** → رشته را کپی کنید (میزبان `-pooler` دارد) = `DATABASE_URL`.
4. همان‌جا **Connection pooling = OFF** → رشته را کپی کنید = `DIRECT_DATABASE_URL`.
5. ادغام خودکار Neon↔Vercel را فعال **نکنید**.

پلن رایگان (طبق مستندات رسمی؛ پیش از اتکا دوباره بخوانید): ۱۰۰ ساعت‌-CU در ماه، ۱ GB، بازیابی فقط تا ۶ ساعت، خواب خودکار پس از ۵ دقیقه بیکاری (درخواست اول بعد از بیکاری کندتر است). پشتیبان رمزشدهٔ روزانهٔ خود برنامه محافظ اصلی داده‌هاست.

## ۴. اجرای migration (یک‌بار، از رایانهٔ خودتان)

```powershell
cd D:\macbook\gamification
git switch main; git pull
npm ci
$s = Read-Host "Paste the DIRECT Neon URL" -AsSecureString
$env:DIRECT_DATABASE_URL = [System.Net.NetworkCredential]::new('', $s).Password
npm run db:migrate          # باید بنویسد: pg migrate: 0001_baseline
Remove-Item Env:DIRECT_DATABASE_URL
```
اجرای دوباره بی‌خطر است. رمز هرگز چاپ نمی‌شود.

## ۵. Vercel — ساخت پروژه و Deploy

1. [vercel.com/new](https://vercel.com/new) → با GitHub وارد شوید → مخزن `ascent-study` را **Import** کنید (اگر دیده نمی‌شود: Adjust GitHub App Permissions).
2. Framework: Next.js (خودکار) · Build/Install را تغییر ندهید.
3. **Settings → Functions → Function Region** = همان منطقهٔ Neon (مثلاً Frankfurt `fra1`). **اجباری است، نه اختیاری:** هر صفحه ده‌ها تا صدها کوئری پشت‌سرهم می‌زند (`/today` حدود ۱۳۰). اگر Function در آمریکا (پیش‌فرض `iad1`) و دیتابیس در اروپا باشد، هر کوئری ~۱۰۰ms طول می‌کشد و صفحه چند ثانیه قفل کاربر را نگه می‌دارد؛ درخواست‌های هم‌زمان بعد از مهلت قفل خطای ۵۰۰ می‌گیرند. با هم‌منطقه بودن، همان صفحه کمتر از یک ثانیه است. بعد از تغییر منطقه باید **Redeploy** کنید.
4. **Settings → Git → Production Branch = `main`**.
5. متغیرهای جدول بخش ۱ را اضافه کنید.
6. **Storage → Create → Blob → Private** → Connect to Project.
7. **Deploy**.

## ۶. Telegram

1. در Telegram به `@BotFather` پیام `/newbot` بدهید، نام و username بدهید، **token** را بگیرید.
2. token را فقط در Vercel به‌عنوان `TELEGRAM_BOT_TOKEN` (Production) بگذارید و **Redeploy** کنید.
3. به bot خودتان یک پیام بدهید (`/start`). chat id عددی را بگیرید: در مرورگر خودتان آدرس `https://api.telegram.org/bot<TOKEN>/getUpdates` را باز کنید (فقط روی رایانهٔ خودتان؛ آدرس را جایی نفرستید) و `message.chat.id` را بخوانید.
4. در برنامه: Settings → Notifications → Telegram را روشن کنید، chat id را ذخیره کنید و **Send test** بزنید.
5. محدودیت صادقانه: روی Vercel یادآورها از طریق کرون **روزانه** ارسال می‌شوند. ربات ثبت سریع (`/test`، `/idea`) یک پروسهٔ دائمی می‌خواهد و روی Vercel اجرا نمی‌شود؛ فقط لوکال با `npm run telegram:bot`.

## ۷. اولین استفاده و بررسی

1. آدرس پروژه را باز کنید → **First-run setup** → نام کاربری دلخواه و رمز (≥ ۱۰ کاراکتر؛ فقط خودتان تایپ می‌کنید). فقط یک‌بار کار می‌کند؛ دادهٔ مرجع (درس‌ها و فصل‌ها) همان لحظه وارد می‌شود.
2. `https://<آدرس>/healthz` → `{"status":"ok"}`.
3. Settings → **Back up now** → یک فایل `.json.gz.enc` ظاهر شود.
4. Vercel → Settings → **Cron Jobs**: `/api/cron/reminders` و `/api/cron/backup`؛ backup را دستی اجرا کنید و ۲۰۰ ببینید.
5. یک تست ثبت کنید، یک Focus شروع/توقف کنید، صفحه را تازه کنید — داده می‌ماند.
6. AI: در Settings وضعیت AI را ببینید (Remote ready)؛ یک پیام به Archie (Coach) بدهید.
7. **تمرین بازیابی (همین هفته):** در Neon یک **Branch** به نام `drill` بسازید، رشتهٔ direct آن را بگیرید، آخرین پشتیبان را از Settings دانلود کنید:
```powershell
$env:OFFSITE_KEY = "<کلید خودتان>"
$s = Read-Host "Direct URL of the DRILL branch" -AsSecureString
$env:RESTORE_DATABASE_URL = [System.Net.NetworkCredential]::new('', $s).Password
npm run restore -- C:\path\to\ascent-....json.gz.enc --drill --migrate
```
   باید `drill passed: N rows verified` ببینید؛ سپس branch `drill` را حذف کنید.
8. **Baseline:** امروز (جمعه ۲۰ نوامبر) روز ۱ است. Baseline را حدود **جمعه ۲۷ نوامبر** تأیید کنید؛ جریمه‌ها فقط پس از آن فعال می‌شوند.

## ۸. اگر چیزی خراب شد

| علامت | کار |
|---|---|
| Deploy موفق ولی ۵۰۰ | `DATABASE_URL` (pooled، فقط Production) و اجرای migration را بررسی کنید؛ لاگ فقط کد خطا نشان می‌دهد |
| Back up now خطا | `OFFSITE_KEY` در Production نیست یا Blob وصل نشده |
| کرون backup ۵۰۰ | همان دو مورد |
| AI جواب نمی‌دهد | `AI_KEY`/`AI_BASE_URL`/`AI_MODEL` در Production؛ برنامه خودکار به پاسخ محلی برمی‌گردد |
| Telegram پیام نمی‌فرستد | توکن Production، chat id در Settings و روشن‌بودن کانال |
| restore خطای checksum | `OFFSITE_KEY` اشتباه یا فایل ناقص |
| درخواست اول کند | خواب خودکار Neon رایگان؛ عادی |
| صفحه‌ها کند یا ۵۰۰ با `55P03` در لاگ | Function Region با منطقهٔ Neon یکی نیست (بخش ۵.۳) |

## ۹. چرا Supabase نه؟

برنامه از Auth/Storage سوپابیس استفاده نمی‌کند و فقط PostgreSQL می‌خواهد. با کد فعلی هم مستقیم وصل نمی‌شود: تأیید TLS در Supabase به ریشهٔ گواهی اختصاصی (`sslrootcert`) نیاز دارد که برنامه عمداً نمی‌پذیرد؛ اتصال direct آن IPv6-only است و pooler حالت session نام `pooler` دارد که ابزار migration رد می‌کند. اگر روزی خواستید، پشتیبانی از آن قابل افزودن و تست است.
