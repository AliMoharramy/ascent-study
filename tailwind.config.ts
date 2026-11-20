import type { Config } from "tailwindcss";

/** Tailwind maps onto the CSS-variable design tokens in app/tokens.css (doc 12 §4, v0.2). */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="night"]'],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        "surface-1": v("surface-1"),
        "surface-2": v("surface-2"),
        line: v("border"),
        ink: v("text"),
        muted: v("text-muted"),
        yellow: v("c-yellow"),
        "yellow-ink": v("yellow-ink"),
        mint: v("c-mint"),
        "mint-ink": v("mint-ink"),
        coral: v("c-coral"),
        "coral-ink": v("coral-ink"),
        purple: v("c-purple"),
        "purple-ink": v("purple-ink"),
        lime: v("c-lime"),
        "lime-ink": v("lime-ink"),
        "on-color": v("on-color"),
        "btn-primary": v("btn-primary"),
        "btn-primary-text": v("btn-primary-text"),
      },
      fontFamily: {
        display: ["'Bebas Neue'", "'Vazirmatn'", "Impact", "sans-serif"],
        body: ["'Nunito'", "'Vazirmatn'", "system-ui", "sans-serif"],
        fa: ["'Vazirmatn'", "'Nunito'", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["72px", { lineHeight: "1.0" }],
        "display-l": ["56px", { lineHeight: "1.0" }],
        "display-m": ["40px", { lineHeight: "1.05" }],
        "title-l": ["28px", { lineHeight: "1.2" }],
        "title-m": ["20px", { lineHeight: "1.25" }],
        body: ["16px", { lineHeight: "1.5" }],
        "body-s": ["14px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.4" }],
      },
      borderRadius: { card: "var(--radius-card)", pill: "999px" },
      boxShadow: { card: "var(--shadow-card)" },
    },
  },
  plugins: [],
} satisfies Config;
