# Art Assets — Batch 1 Brief (Issue #10)

> تولید: **کاربر** با Gemini / Nano Banana (D30). آماده‌سازی (این سند، پوشه‌ها، `Art` component، اعتبارسنجی، بهینه‌سازی): AI.
> سبک و شخصیت‌ها: `docs/mascot-bible.md`. تصویر مرجع سبک: `public/art/reference/hero-idle-reference.png` (issue #9).
> **پوشه‌ها اکنون ساخته شده‌اند** (`.gitkeep` دارند): `public/art/{hero,shade,archie,map,realms,scenes,fog,reference}` و `public/icons/`. فایل‌ها را با همین نام‌ها داخلشان بگذارید.

## 0. محدودیت Nano Banana (آلفا ندارد) — راه‌حل

Nano Banana خروجی **شفاف (alpha)** نمی‌دهد. دو راه، به‌ترتیب ترجیح:

1. **پس‌زمینهٔ تخت هم‌رنگ (پیشنهادی، «گزینه ۱»):** هر شخصیت/باس را روی یک رنگ تخت کرم `#F5F2EA` تولید کنید و در UI داخل یک **کاشی گرد کرم (sticker)** نشان دهید. چون Style Block خودش «2D sticker style» است، پس‌زمینهٔ تخت intentional به‌نظر می‌رسد، نه مربع بدقواره. بدون نیاز به حذف پس‌زمینه.
2. **Chromakey (اگر ابزار حذف دارید):** پس‌زمینه را **سرخابی تخت `#FF00FF`** بگذارید، سپس در ویرایشگر حذف کنید → WebP شفاف. فقط اگر مرحلهٔ حذف برایتان ممکن است.

صحنه‌ها/نقشه/قلمروها full-bleed هستند (پس‌زمینه بخشی از صحنه است: آسمان شب، طلوع، غار) → قانون «پس‌زمینهٔ تخت» فقط برای **شخصیت‌ها و باس** اعمال می‌شود.

## 1. فهرست Batch 1 (۲۷ فایل) + نسبت تصویر Nano Banana

| # | فایل | محتوا | نسبت NB | ابعاد نهایی | سقف WebP |
|---|---|---|---|---|---|
| 1–5 | `art/hero/hero-{idle,happy,thinking,celebrate,tired}.webp` | Hero، ۵ حالت | 1:1 | 1024² | 120 KB |
| 6–8 | `art/shade/shade-{smug,winner,defeated}.webp` | Shade، ۳ حالت | 1:1 | 1024² | 120 KB |
| 9–12 | `art/archie/archie-{reading,thinking,cheering,warning}.webp` | Archie، ۴ حالت | 1:1 | 1024² | 120 KB |
| 13 | `art/map/world-map.webp` | نقشهٔ جهان: ۴ قلمرو + قله | 3:2 | 2400×1600 | 450 KB |
| 14–17 | `art/realms/realm-{1,2,3,4}.webp` | Citadel · Forge · Spire · Deep | 16:9 | 1600×900 | 250 KB |
| 18–25 | `art/scenes/scene-{study,run,sleep,read,idea,duel,celebrate,calm}.webp` | صحنه‌های کارت | 4:3 | 1200×900 | 160 KB |
| 26 | `art/fog/fog-weekly.webp` | Fog Critter باس هفتگی | 1:1 | 1024² | 120 KB |
| 27 | `icons/icon-512.png` | لوگو PWA: قلهٔ تیره + پرچم زرد روی دایرهٔ زرد | 1:1 | 512² | 60 KB |

Nano Banana نسبت را به‌عنوان setting می‌گیرد؛ ابعاد پیکسلی دقیق را در مرحلهٔ resize نهایی اعمال کنید (§3).

## 2. پرامپت‌های کامل (کپی‌پیست)

**پرامپت کامل = یکی از دو STYLE زیر + خط subject مربوطه.** هیچ متنی روی تصویر نگذارید.

### STYLE_CHARACTER (برای #1–12 و #26 — sticker روی کرم تخت)
```
flat vector illustration, 2D sticker style, thick dark outlines (#111114), bold simple shapes,
playful friendly character, limited vivid palette: warm yellow #F2C24E, mint #8FD9D0, coral red #E8553F,
violet #7C6CF2, lime #9BD24E, tiny sparkles and confetti accents, clean solid single-color warm cream
background #F5F2EA, no text, no watermark, centered subject with safe margins, consistent character design
```
(اگر chromakey می‌کنید: `warm cream background #F5F2EA` را با `solid flat magenta background #FF00FF` عوض کنید.)

### STYLE_SCENE (برای #13–25 — full-bleed، پس‌زمینه بخشی از صحنه)
```
flat vector illustration, thick dark outlines (#111114), bold simple shapes, playful friendly mood,
limited vivid palette: warm yellow #F2C24E, mint #8FD9D0, coral red #E8553F, violet #7C6CF2, lime #9BD24E,
soft gradients for sky and fog, no text, no watermark, consistent world design, 2D storybook style
```

### Subject هر فایل (به STYLE بچسبانید)
1. `hero-idle`: a gender-neutral young climber in a yellow hoodie #F2C24E with a small backpack and coiled climbing rope, short messy dark hair, dark hiking boots, standing confidently ready to climb, full body
2. `hero-happy`: the same yellow-hoodie climber raising one fist in triumph with a big friendly smile, full body
3. `hero-thinking`: the same climber with a hand under the chin and a small floating question mark, puzzled but friendly, full body
4. `hero-celebrate`: the same climber jumping with arms up amid confetti and tiny sparkles, full body
5. `hero-tired`: the same climber sitting on a rock resting with a small tea cup, calm and content (not sad), full body
6. `shade-smug`: a violet #7C6CF2 smoke silhouette of the same climber with white almond eyes and a long scarf, arms crossed, mischievous crooked smile, full body
7. `shade-winner`: the same violet smoke twin taking a theatrical bow, full body
8. `shade-defeated`: the same violet smoke twin sitting with a tiny white flag, playful not scary, full body
9. `archie-reading`: a round owl-robot with a mint #8FD9D0 body, big round glasses, a tiny antenna with a yellow light, reading a book held in its wing
10. `archie-thinking`: the same owl-robot with tiny gears floating above its head and a wing on its chin
11. `archie-cheering`: the same owl-robot with both wings raised amid confetti
12. `archie-warning`: the same owl-robot holding one wing forward beside a coral exclamation mark
13. `world-map`: top-down playful fantasy map of four regions (violet brain citadel, orange forge, mint machine tower, deep-blue cave systems) connected by a winding path to a snowy summit, soft fog patches
14. `realm-1`: Citadel of Minds — a violet brain-shaped citadel of library towers with glowing synapse bridges
15. `realm-2`: Forge of Structures — an orange forge with gear anvils and data-structure scaffolds
16. `realm-3`: Machine Spire — a tall mint machine tower of chips and antennas
17. `realm-4`: Deep Systems — deep-blue cave systems with terminal glow and pipes
18. `scene-study`: a climber studying at a desk at night with a glowing lamp and stacked books, cozy
19. `scene-run`: a climber jogging at sunrise on a mountain trail
20. `scene-sleep`: a climber sleeping peacefully in a small tent under stars
21. `scene-read`: a climber reading a paperback in a hammock
22. `scene-idea`: a climber putting a glowing lightbulb into a locked treasure chest labelled with a lock icon (idea vault)
23. `scene-duel`: a yellow-hoodie climber and a violet smoke twin facing each other on a ridge, friendly rivalry
24. `scene-celebrate`: a climber jumping with confetti on a summit flag
25. `scene-calm`: a climber sitting on a rock drinking tea, watching clouds
26. `fog-weekly`: a fluffy round fog monster in coral and grey with big silly eyes holding a tiny clock, defeatable and funny
27. `icon-512`: minimal flat logo of a dark summit mountain with a small yellow flag centered on a solid yellow #F2C24E circle, no text (STYLE_SCENE بدون palette gradient؛ ساده و آیکنی)

## 3. تحویل و بهینه‌سازی
1. فایل‌ها را با نام‌های بالا (PNG یا WebP) در پوشه‌ها بگذارید.
2. تبدیل/resize به ابعاد دقیق جدول + WebP کیفیت ۸۲ (به‌جز icon که PNG می‌ماند). AI می‌تواند این مرحله را انجام دهد.
3. `npm run art:validate` → نام/ابعاد/حجم/فرمت را چک می‌کند؛ فایل غایب = گزارش (batch pending)، فایل حاضرِ ناقض = خطا.
4. ثبت هر فایل در `public/art/LICENSE.md` (ابزار، تاریخ، پرامپت، original: yes).
5. UI: component `Art` (`src/ui/Art.tsx`) تصویر را نشان می‌دهد و تا رسیدن فایل، SVG داخلی fallback است (هیچ صفحه‌ای منتظر تصویر نیست). HeroFocusCard از `art/hero/hero-idle.webp` استفاده می‌کند.

## 4. اصالت و مجوز
هر فایل در `public/art/LICENSE.md` با «ابزار تولید، تاریخ، پرامپت، original: yes» ثبت می‌شود. فقط سبک از مرجع‌ها؛ هیچ شخصیت/برند مرجع کپی نمی‌شود (سند 12 §8.3).