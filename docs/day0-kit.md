# کیت روز صفر (Day-0 Baseline Kit) — Issue #11

> برای روزهایی که سایت هنوز بالا نیامده (سند 09 §3). ثبت روزانه ≤ ۲ دقیقه روی کاغذ/یادداشت گوشی. بعداً یک‌جا Import می‌شود (Settings → Import Day-0 kit). **هیچ XP یا جریمه‌ای برای این روزها نیست** — فقط مشاهدهٔ خود (Ch.1 The Awakening).

## ۱. قالب یک روز (کپی کنید)

```
تاریخ: 1405-08-__
بیداری: __:__      خواب: __:__
بلوک‌های مطالعه: __:__-__:__ ; __:__-__:__ ; …      درس: ____
تست‌ها: درست __  غلط __  نزده __      درس تست: ____
انرژی (۱ تا ۵):  صبح __  ظهر __  شب __
بزرگ‌ترین مانع: ______________________
بزرگ‌ترین فرار: ____ دقیقه — نوع: coding / new_idea / social / video / games / news / other
کلاس رفتم؟ بله / خیر / کلاس نداشتم
یادداشت: ______________________
```

## ۲. همان داده به‌صورت CSV (برای Import)
ستون‌ها (ترتیب آزاد، فقط `date` اجباری):

```
date,wake,bed,study_blocks,study_subject,correct,wrong,blank,test_subject,energy_morning,energy_noon,energy_night,blocker,escape_minutes,escape_kind,class_attended,note
1405-08-23,07:30,23:45,10:00-11:30; 16:00-17:15,ai,12,4,2,foundations,3,4,2,خستگی بعد از کلاس,45,coding,yes,
```

| ستون | قالب | مثال |
|---|---|---|
| `date` | شمسی `1405-08-23` یا `1405/08/23`، یا میلادی `2026-11-14`؛ ارقام فارسی مجاز | `۱۴۰۵/۰۸/۲۳` |
| `wake`, `bed` | `HH:MM` | `08:20` |
| `study_blocks` | بازه‌ها با `;` یا `\|`؛ عبور از نیمه‌شب مجاز | `23:30-00:40` |
| `study_subject`, `test_subject` | شناسهٔ درس: `ai, discrete, dsa, logic, arch, toc, os, stats, foundations, english` | `ai` |
| `correct`, `wrong`, `blank` | عدد صحیح | `12` |
| `energy_*` | ۱ تا ۵ | `3` |
| `escape_kind` | `coding, new_idea, social, video, games, news, other` | `coding` |
| `class_attended` | `yes/no` یا `بله/خیر` | `yes` |

- قالب آماده: Settings → **Template** (یا `GET /api/import/day0`).
- Import ابتدا **پیش‌نمایش** و خطای هر سطر را نشان می‌دهد؛ سپس ذخیره. داده‌ها برچسب `manual` می‌گیرند. Import دوبارهٔ همان روز نادیده گرفته می‌شود (idempotent).
- یک برگهٔ Google Sheets/Excel با همین ستون‌ها بسازید و «Download as CSV» کنید؛ یا از یادداشت کاغذی هر شب یک سطر تایپ کنید.
