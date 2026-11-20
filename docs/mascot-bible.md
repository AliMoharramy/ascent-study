# Mascot Bible v1 — THE ASCENT (Issue #9 · Q11/Q12)

> تصمیم (پیش‌فرض قابل‌تغییر، ADR در `docs/adr.md` / سند 10 §F): **سبک تصویرسازی = برداری تخت با خط دور ضخیم** (مرجع ۱) برای همهٔ صحنه‌ها و شخصیت‌ها؛ **مدال‌های براق نیمه‌سه‌بعدی** فقط برای Achievements (مرجع ۲). دلیل: ثبات بین تصاویر تولیدی AI، حجم کم، خوانایی روی کارت‌های رنگی.
> قانون حقوقی: فقط سبک از مرجع‌ها؛ هیچ شخصیت/برند مرجع (Classo، زنبور، ربات) کپی نمی‌شود.

## 1. لحن کلی
بازیگوش در تصویر، **بالغ و کوتاه در متن**. شخصیت‌ها هرگز تحقیر نمی‌کنند؛ شکست = «داده»، نه «گناه».

## 2. شخصیت‌ها

### Hero — «The Ascender» (کاربر)
| ویژگی | تعریف |
|---|---|
| نقش | قهرمان؛ نمایندهٔ کاربر |
| ظاهر | شخصیت جنسیت‌خنثی، موی کوتاه نامرتب، هودی **زرد** (`#F2C24E`) با کوله‌پشتی کوچک و طناب کوهنوردی؛ کفش کوهنوردی تیره؛ بدون جزئیات چهرهٔ واقع‌گرا |
| حالات (۵) | `idle` ایستاده و آماده · `happy` مشت بالا · `thinking` دست زیر چانه با علامت سؤال کوچک · `celebrate` پرش با کنفتی · `tired` نشسته روی سنگ با فنجان چای (نه غمگین — در حال استراحت) |
| کاربرد | HeroFocusCard، صفحهٔ نتیجه، Level Up، روز بد (حالت tired + دکمهٔ Seed) |

### Shade — رقیب سایه (Shadow Rival)
| ویژگی | تعریف |
|---|---|
| نقش | دوقلوی برنامه‌محور کاربر (الگوریتم سند 04 §7) |
| ظاهر | سیلوئت همان Hero ولی **بنفش** (`#7C6CF2`) با لبه‌های دودی و چشم‌های سفید بادامی؛ شال بلند؛ شیطنت‌آمیز، نه ترسناک |
| حالات (۳) | `smug` لبخند کج و دست به سینه · `winner` تعظیم نمایشی · `defeated` نشسته با پرچم سفید کوچک |
| لحن متن | کم‌حرف، رقابتی، منصف: «این هفته جلو افتادی. هفتهٔ بعد؟» |

### Archie — مربی (Archivist)
| ویژگی | تعریف |
|---|---|
| نقش | راهنما؛ بعداً صدای دستیار AI (R4) |
| ظاهر | **جغد-ربات** گرد با بدنهٔ فیروزه‌ای (`#8FD9D0`)، عینک گرد بزرگ، آنتن کوچک با نور زرد، یک کتاب زیر بال |
| حالات (۴) | `reading` · `thinking` (چرخ‌دنده‌های کوچک بالای سر) · `cheering` (بال‌ها بالا) · `warning` (بال جلو، علامت تعجب مرجانی) |
| لحن متن | کوتاه، دقیق، داده‌محور: «۳ خطای تکراری در فصل ۴. ۱۰ دقیقه مرورش کنیم؟» |

### Fog Critters — باس‌ها
موجودات مه‌ای گرد و پشمالو با رنگ **مرجانی/خاکستری**، چشم‌های بزرگ، خنده‌دار و قابل‌شکست. یکی برای Weekly Boss، چهار تا برای قلمروها (هر کدام با نشانهٔ درس: مغز/چرخ‌دنده/تراشه/ترمینال)، یکی بزرگ برای Summit Warden.

## 3. پالت تصویرسازی
فقط رنگ‌های توکن: زرد `#F2C24E`، نعنایی `#8FD9D0`، مرجانی `#E8553F`، بنفش `#7C6CF2`، لیمویی `#9BD24E`، خط دور `#111114`، سفید گرم `#F5F2EA`. پس‌زمینهٔ هر تصویر **یک رنگ تخت** (یا شفاف).

## 4. پرامپت پایه (Style Block — ثابت در همهٔ تولیدها)
```
flat vector illustration with thick dark outlines (#111114), bold simple shapes, playful friendly character,
limited vivid palette: warm yellow #F2C24E, mint #8FD9D0, coral red #E8553F, violet #7C6CF2, lime #9BD24E,
tiny sparkles and confetti accents, clean solid single-color background, no text, no watermark,
centered subject with safe margins, consistent character design, 2D sticker style
```
مدال‌ها:
```
glossy semi-3D rounded badge medal with ribbon, soft studio lighting, simple centered icon, cream background #F6EBD5, no text
```

## 5. نمونه پرامپت‌ها
- Hero idle: `[STYLE] — a gender-neutral young climber in a yellow hoodie with a small backpack and climbing rope, standing confidently, full body, transparent background`
- Shade smug: `[STYLE] — the same climber silhouette but made of violet smoke with white almond eyes and a long scarf, arms crossed, mischievous smile, full body, transparent background`
- Archie reading: `[STYLE] — a round owl-robot with a mint body, big round glasses, a tiny antenna with a yellow light, reading a book held in its wing, transparent background`
- Weekly boss: `[STYLE] — a fluffy round fog monster in coral and grey, big silly eyes, holding a tiny clock, defeatable and funny, transparent background`

## 6. قواعد ثبات
1. همیشه همان Style Block؛ یک «تصویر مرجع سبک» (اولین Hero تأییدشده) به‌عنوان image reference.
2. Hero هرگز ناراحت/گریان نیست؛ «tired» = استراحت.
3. Shade هیچ‌وقت ترسناک یا تحقیرآمیز نیست.
4. متن روی تصویر ممنوع (متن‌ها در UI و قابل ترجمه‌اند).
5. خروجی: Nano Banana آلفای واقعی ندارد → شخصیت/باس روی **کرم تخت `#F5F2EA`** (sticker) یا chromakey سرخابی؛ صحنه‌ها full-bleed. تبدیل به WebP (کیفیت ۸۲) ≤ ۱۲۰ KB و resize به ابعاد `docs/art-brief.md`. نام‌گذاری: `docs/art-brief.md`.
