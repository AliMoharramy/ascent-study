# Art assets: license and provenance register

## License

The artwork in `public/art/` is licensed separately from the source code (which is MIT, see `/LICENSE`):

- **Artwork: [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)** — you may use,
  adapt and redistribute it, including commercially, if you credit "THE ASCENT project".
- The images were generated with AI image tools (see the register below). Whether, and by whom, AI-generated images can be
  copyrighted depends on your jurisdiction and on the generator's terms, so this license applies **only to the extent the
  project owner holds any rights**, and comes with no warranty. If you need certainty for a commercial product, replace
  these files with your own.
- Fonts are third-party (SIL OFL 1.1: Bebas Neue, Nunito, Vazirmatn) and keep their own licenses.

## Provenance register

All images in `public/art/` are original, generated for THE ASCENT by the project owner with AI image tools
(style only inspired by third-party reference screenshots that are intentionally **not** included in this repository;
no characters, logos or brands copied).

| file | tool | date | prompt ref | original |
|---|---|---|---|---|
| `reference/hero-idle-reference.png` | ImageGen (style anchor, issue #9) | 1405-08-24 | `docs/mascot-bible.md` §4–5 (Style Block + Hero idle) | yes |
| `hero/hero-idle.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #1 | yes |
| `hero/hero-happy.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #2 | yes |
| `hero/hero-thinking.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #3 | yes |
| `hero/hero-celebrate.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #4 | yes |
| `hero/hero-tired.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #5 | yes |
| `shade/shade-smug.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #6 | yes |
| `shade/shade-winner.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #7 | yes |
| `shade/shade-defeated.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #8 | yes |
| `archie/archie-reading.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #9 | yes |
| `archie/archie-thinking.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #10 | yes |
| `archie/archie-cheering.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #11 | yes |
| `archie/archie-warning.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #12 | yes |
| `archie/archie-reviewing.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/mascot-bible.md` §2 extra state (holds the review eraser) | yes |
| `map/world-map.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #13 | yes |
| `realms/realm-1.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #14 | yes |
| `realms/realm-2.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #15 | yes |
| `realms/realm-3.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #16 | yes |
| `realms/realm-4.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #17 | yes |
| `scenes/scene-study.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #18 | yes |
| `scenes/scene-run.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #19 | yes |
| `scenes/scene-sleep.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #20 | yes |
| `scenes/scene-read.webp` | Gemini (user-supplied) | not provided | `docs/art-brief.md` #21 | yes |
| `scenes/scene-idea.webp` | Qoder ImageGen (style-ref `scenes/scene-study.webp`; Pillow resize/WebP q82) | 2026-11-17 | `docs/art-brief.md` #22 (STYLE_SCENE) | yes |
| `scenes/scene-duel.webp` | Qoder ImageGen (style-ref `scenes/scene-study.webp`; Pillow resize/WebP q82) | 2026-11-17 | `docs/art-brief.md` #23 (STYLE_SCENE) | yes |
| `scenes/scene-celebrate.webp` | Qoder ImageGen (style-ref `scenes/scene-study.webp`; Pillow resize/WebP q82) | 2026-11-17 | `docs/art-brief.md` #24 (STYLE_SCENE) | yes |
| `scenes/scene-calm.webp` | Qoder ImageGen (style-ref `scenes/scene-study.webp`; Pillow resize/WebP q82) | 2026-11-17 | `docs/art-brief.md` #25 (STYLE_SCENE) | yes |
| `fog/fog-weekly.webp` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #26 | yes |
| `icons/icon-512.png` | Gemini (user-supplied, final batch) | 2026-11-16 | `docs/art-brief.md` #27 | yes |

Prepared by the asset pipeline (resize to `docs/art-brief.md` dimensions, WebP quality 82, PNG palette for the icon).
