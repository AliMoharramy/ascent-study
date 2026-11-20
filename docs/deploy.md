# استقرار THE ASCENT (Deploy)

> معماری (Database V2): **یک پایگاه‌دادهٔ PostgreSQL تراکنشی، تنها منبع حقیقت.** هر Function، هر کانتینر و هر ابزار عملیاتی به همان دیتابیس وصل می‌شود.
> فایل SQLite و snapshot در Blob دیگر هرگز دیتابیس زنده نیستند. Blob فقط برای **پشتیبان‌های رمزشده** است.

## ۰. تصمیم‌های معماری (خلاصه)

| موضوع | تصمیم | دلیل |
|---|---|---|
| دیتابیس production | PostgreSQL مدیریت‌شده (طرح فعلی: Neon) | Vercel Functions روی instanceهای جدا اجرا می‌شوند؛ فقط دیتابیس مشترک تراکنشی از lost update جلوگیری می‌کند |
| دیتابیس لوکال و تست | PostgreSQL در Docker (`docker compose`) | یک dialect، بدون هزینهٔ dual-dialect؛ `make dev` همچنان یک دستور است |
| اتصال runtime | `DATABASE_URL` (pooled) | سازگار با serverless |
| اتصال migration/ابزار | `DIRECT_DATABASE_URL` (direct) | قفل advisory نشست‌محور به اتصال مستقیم نیاز دارد |
| همروندی | قفل advisory تراکنشی per-user + قیدهای یکتای دیتابیس | هر عملیات دامنه (رویداد + projection + دفترها) یک تراکنش اتمی است |
| Migration | فقط با دستور صریح، نه در cold start و نه در build | جلوگیری از race بین deployها |
| پشتیبان | آرشیو gzip-JSON سازگار، رمزشده (AES-256-GCM)، در Blob خصوصی | قابل‌حمل، قابل بازیابی در هر PostgreSQL تازه |

> **قبل از خرید/تنظیم هر پلن:** محدودیت‌های provider (اندازهٔ ذخیره‌سازی، پنجرهٔ بازیابی نقطه‌ای، قطع خودکار در idle، سقف اتصال) را از مستندات رسمی همان روز بخوانید؛ این سند عمداً عددی از provider ننوشته است. پیشنهاد: پلن رایگان برای pilot، و پیش از «روزهای مهم» بررسی کنید که ظرفیت و بازیابی کافی است.

## ۱. متغیرهای محیطی

| متغیر | کجا | توضیح |
|---|---|---|
| `DATABASE_URL` | Production (و لوکال) | رشتهٔ اتصال **pooled** برای runtime. TLS تأییدشده اجباری است. |
| `DIRECT_DATABASE_URL` | فقط ابزار/اپراتور و CI migration | اتصال **direct** (بدون pooler) برای `db:migrate`، restore و dump. روی Vercel Runtime قرار ندهید. |
| `TEST_DATABASE_URL` | فقط لوکال/CI | دیتابیس **دورریختنی**؛ هرگز production. با `DATABASE_URL` یکی نباشد. |
| `RESTORE_DATABASE_URL` | فقط هنگام restore | مقصد صریح بازیابی (برای drill یک دیتابیس خالی). |
| `DB_POOL_MAX` | اختیاری | حداکثر اتصال هر instance (۱–۱۰، پیش‌فرض ۴). |
| `OFFSITE_KEY` | Production | کلید رمزنگاری پشتیبان (عبارت طولانی یا ۶۴ هگز). **جدا از پشتیبان‌ها نگه دارید**؛ بدون آن بک‌آپ بازیافتنی نیست. بدون آن پشتیبان Vercel اجرا نمی‌شود. |
| `CRON_SECRET` | Production | محافظ `/api/cron/*`. |
| `BACKUP_DIR` / `OFFSITE_DIR` | لوکال/Docker | مسیرهای پایدار. روی Vercel استفاده نمی‌شوند. |
| `AI_BASE_URL` / `AI_KEY` / `AI_MODEL` / `AI_TIMEOUT_MS` | اختیاری | بدون تغییر نسبت به قبل؛ فقط در env. |
| `TELEGRAM_BOT_TOKEN` | اختیاری | فقط در env. |
| `CAPSULE_KEY` | اختیاری | کلید کپسول زمان؛ جدا از پشتیبان. |
| `TZ` | همه | `Asia/Tehran` |
| `DISABLE_JOBS` | لوکال | `true` = بدون Jobهای node-cron. |
| `COOKIE_SECURE` | خودکار | فقط برای HTTP بدون TLS `false`. |

قواعد:
- مقدارهای production را **فقط** در Environment «Production» بگذارید، نه Preview/Development.
- هیچ رشتهٔ اتصال یا کلیدی را در Git، لاگ، issue یا گفتگو نگذارید. خطاهای دیتابیس به کلاینت و لاگ فقط با کد SQLSTATE می‌رسند.
- Previewها باید به یک دیتابیس جدا (branch/پروژهٔ جدا) وصل شوند، نه production.

## ۲. راه‌اندازی بار اول (production)

این مراحل را شما از حساب خودتان انجام می‌دهید (ساخت حساب/دیتابیس توسط ابزار خودکار انجام نمی‌شود):

1. در provider یک پروژهٔ PostgreSQL بسازید (منطقهٔ نزدیک به منطقهٔ Functions در Vercel). دو رشته بگیرید: **pooled** (برای runtime) و **direct** (برای migration).
2. در Vercel → Project → Environment Variables (فقط Production): `DATABASE_URL` (pooled)، `OFFSITE_KEY`، `CRON_SECRET`، و در صورت نیاز AI/Telegram.
3. یک **private Blob store** به پروژه وصل کنید (برای پشتیبان‌های رمزشده؛ SDK از OIDC استفاده می‌کند).
4. **Migration را از رایانهٔ خودتان اجرا کنید (بخش ۳)** — پیش از اولین deploy.
5. Deploy. دیتابیس production از صفر است؛ **داده‌ی SQLite لوکال وارد نمی‌شود.**
6. صفحهٔ First-run setup را باز کنید و حساب را بسازید. ساخت حساب اتمی است؛ دو درخواست هم‌زمان فقط یک حساب می‌سازند و بعد از آن ثبت‌نام بسته است. دادهٔ مرجع (درس‌ها، فصل‌ها…) همان لحظه ایدمپوتنت وارد می‌شود؛ اگر شکست خورد از Settings یا `npm run db:seed` تکرار کنید.

اگر پیش‌تر یک دیتابیس pilot (Blob-SQLite) روی Vercel دارید، **قبل از هر کار** از آن export بگیرید (Settings → Export) و فایل را نگه دارید؛ چیزی را جایگزین نکنید.

## ۳. فرایند انتشار (Release) و Migration

قانون: **migration هرگز در cold start، build یا هر Function اجرا نمی‌شود.** قفل advisory (`pg_advisory_lock`) روی اتصال direct هم اجرای هم‌زمان دو deploy را سریالی می‌کند و checksum هر فایل در جدول `_migrations` ثبت و بررسی می‌شود (تغییر فایلِ اعمال‌شده = خطا).

ترتیب هر انتشار:

```bash
# ۱) پشتیبان تازه (اتصال به production با DATABASE_URL یا DIRECT_DATABASE_URL)
npm run backup

# ۲) migration با اتصال direct — قبل از promote کردن deploy
DIRECT_DATABASE_URL="<direct-url>" npm run db:migrate

# ۳) deploy / promote در Vercel
# ۴) چک‌لیست staging (بخش ۸)
```

به‌جای رایانهٔ خودتان می‌توانید workflow دستی `Migrate production` در GitHub Actions را اجرا کنید (Environment به نام `production` با تأیید دستی و secret به نام `DIRECT_DATABASE_URL`).

### سیاست Rollback / Forward-fix
- Migrationها **فقط رو به جلو** هستند. `db:rollback` وجود ندارد.
- هر migration باید با نسخهٔ قبلی برنامه سازگار باشد (expand → deploy → contract): ستون جدید nullable/با default، حذف ستون فقط در انتشار بعدی.
- migration مخرب (DROP/تبدیل نوع) فقط پس از پشتیبان تازه و در دو انتشار جدا.
- اگر انتشار مشکل داشت: ابتدا در Vercel به deploy قبلی برگردید (به‌خاطر سازگاری به عقب، اسکیما همچنان کار می‌کند). مشکل داده → بازیابی از آرشیو (بخش ۴). مشکل اسکیما → migration اصلاحی رو به جلو.

## ۴. پشتیبان، بازیابی و drill

**پشتیبان خودکار (Vercel):** کرون `/api/cron/backup` روزانه (۰۰:۰۰ UTC ≈ ۰۳:۳۰ تهران): آرشیو سازگار ← رمزنگاری ← ذخیره در Blob خصوصی ← خواندن مجدد و اعتبارسنجی ← نگهداری ۳۰ نسخهٔ آخر. اگر هر مرحله شکست بخورد کرون با خطای ۵۰۰ پایان می‌یابد (در لاگ Vercel دیده می‌شود) و نسخهٔ ناقص «پشتیبان» حساب نمی‌شود. بدون `OFFSITE_KEY` اجرا نمی‌شود (عمدی).
**پشتیبان دستی:** Settings → Back up now، یا Export all data، یا `npm run backup` (فایل محلی تأییدشده در `BACKUP_DIR`).
**کپی خارج از سرویس (توصیه، هفتگی):** `npm run offsite` با `OFFSITE_KEY`.

> آرشیو شامل نشست‌های ورود **نیست**؛ بعد از بازیابی باید دوباره وارد شوید. کلیدهای `OFFSITE_KEY` و `CAPSULE_KEY` را جدا از آرشیو نگه دارید.

**Restore drill (حداقل ماهی یک بار و قبل از روزهای مهم):**
```bash
# دیتابیس خالی و موقت بسازید و آدرس direct آن را بدهید
RESTORE_DATABASE_URL="<scratch-direct-url>" OFFSITE_KEY="<key>" \
  npm run restore -- <file.json.gz.enc> --drill --migrate
```
`--drill` هرگز دادهٔ موجود را بازنویسی نمی‌کند، و هر جدول را بعد از درج با آرشیو مقایسه می‌کند؛ هر اختلاف = شکست و بازگردانی کامل تراکنش.

**بازیابی واقعی (جایگزین‌کردن production):** فقط پس از گرفتن پشتیبان تازه:
```bash
RESTORE_DATABASE_URL="<prod-direct-url>" DATABASE_URL="<prod-direct-url>" \
  npm run restore -- <file> --replace
```
(با `--replace` صریح؛ بدون آن اگر کاربری وجود داشته باشد خطا می‌دهد.) سپس دوباره وارد شوید.

**انتقال داده بین لوکال و production:** Settings → Export / Import (آرشیو `.json.gz`). محدودیت Vercel: بدنهٔ درخواست بیش از ۴٫۵ MB قبل از رسیدن به برنامه رد می‌شود؛ برای آرشیو بزرگ‌تر از `npm run restore` استفاده کنید. Import پیش از جایگزینی یک پشتیبان تأییدشده می‌گیرد و اگر نتواند، چیزی را عوض نمی‌کند.

**بازیابی نقطه‌ای provider:** ابزار تکمیلی برای «چند ساعت اخیر» است؛ دامنهٔ آن را از مستندات provider بخوانید. آرشیو برنامه پشتیبان اصلی و مستقل از provider است.

## ۵. Jobها

`vercel.json`: `/api/cron/reminders` (۰۵:۰۰ UTC) و `/api/cron/backup` (۰۰:۰۰ UTC)، با `Authorization: Bearer $CRON_SECRET`. روی Hobby، کرون روزانه است و ممکن است تا حدود یک ساعت جابه‌جا شود. لوکال/Docker: `node-cron` (هر ۱۵ دقیقه یادآور؛ `BACKUP_DIR` ← پشتیبان شبانه ۰۳:۳۰). با `DISABLE_JOBS=true` خاموش می‌شود. `/healthz` فقط زنده‌بودن پروسه را می‌گوید و دیتابیس را بیدار نمی‌کند.

## ۶. اجرای لوکال

نیازمند Node 22 و Docker:

```bash
make dev        # PostgreSQL محلی (docker compose) ← migrate ← seed ← کاربر dev ← سرور روی :3100
make login      # آدرس و نام کاربری
make test       # تست‌های واحد (بدون دیتابیس)
make test-pg    # تست‌های یکپارچگی روی schemaهای ایزولهٔ PostgreSQL
make db-stop    # توقف دیتابیس لوکال (داده نمی‌ماند حذف نمی‌شود)
```
بدون make: `docker compose up -d --wait postgres` سپس `DATABASE_URL=… DIRECT_DATABASE_URL=… npm run db:migrate && npm run db:seed && npm run dev`.

`.env.local` برای Telegram/AI لوکال خوانده می‌شود؛ هرگز `DATABASE_URL` production را در لوکال نگذارید.

## ۷. Docker / خودمیزبانی

`docker compose --profile selfhost up -d --build` (PostgreSQL + اپ + Caddy). اپ در شروع migration اجرا نمی‌کند؛ یک‌بار با تصویر ابزار:

```bash
docker build --target tools -t the-ascent:tools .
docker run --rm --network <compose-network> -e DIRECT_DATABASE_URL=<url> the-ascent:tools npm run db:migrate
```
دادهٔ PostgreSQL در volume ‏`ascent-postgres` است؛ پشتیبان‌ها در `ascent-backups` (`/data/backups`). بازنشانی رمز: `npm run user:reset-password` با `DATABASE_URL` مقصد.

## ۸. چک‌لیست staging (قبل از هر انتشار مهم)

- [ ] ورود و خروج؛ First-run روی دیتابیس تازه فقط یک حساب می‌سازد.
- [ ] برنامهٔ روزانه، Focus (شروع/توقف)، ثبت تست، کارت‌های مرور.
- [ ] retry: دو بار ثبت یک تست با همان `clientRequestId` ← یک لاگ.
- [ ] AI (در صورت فعال بودن) و تست ارسال Telegram؛ یادآورها.
- [ ] Export، پشتیبان دستی، **restore drill** روی دیتابیس موقت.
- [ ] `/api/cron/backup` با `CRON_SECRET` درست ۲۰۰ و بدون آن ۴۰۱ می‌دهد.
- [ ] صف آفلاین (`/api/sync`) پس از قطع/وصل شبکه.

## ۹. محدودیت‌ها

- Hobby: کرون روزانه؛ یادآورها روزانه dispatch می‌شوند.
- بدنهٔ درخواست Vercel ≤ ۴٫۵ MB (import آرشیو بزرگ → `npm run restore`).
- مسیرهای AI و کرون پشتیبان تا ۶۰ ثانیه تنظیم شده‌اند (`maxDuration`)؛ طبق مستندات فعلی Vercel سقف Hobby با Fluid Compute بیشتر از این است، اما مقدار فعلی را از صفحهٔ Limits همان روز بخوانید.
- هر Function حداکثر `DB_POOL_MAX` (پیش‌فرض ۴) اتصال به pooler باز می‌کند؛ ظرفیت اتصال provider را با تعداد instanceهای هم‌زمان بسنجید.

برای ساخت Telegram bot و ثبت chat id: به `@BotFather` پیام `/newbot` بدهید، token را فقط در env (`TELEGRAM_BOT_TOKEN`) بگذارید، `npm run telegram:bot` را لوکال اجرا کنید، به bot پیام `/start` بدهید و chat id را در Settings → Notifications ذخیره کنید.
