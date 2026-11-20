// npm run screenshots — regenerates the README gallery (docs/images/*) from a running app with demo data.
//
//   npm run db:migrate && npm run demo:seed          # empty local database → three weeks of sample data
//   npm run build && npm start                       # (or `npm run dev`) in another terminal
//   npm run screenshots -- --base http://localhost:3000
//
// Needs Chrome, Edge or Chromium (CHROME_PATH to point at it). Writes optimised WebP files, a hero image
// (both themes side by side) and a 1280×640 social-preview image. Uses only puppeteer-core — no image library.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = flag("--base", "http://localhost:3000");
const out = flag("--out", "docs/images");
const user = process.env.DEMO_USER ?? "demo";
const password = process.env.DEMO_PASSWORD ?? "demo-password-123";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error("No Chrome/Edge/Chromium found — set CHROME_PATH.");
  process.exit(1);
}

const PAGES = [
  ["today", "/today"],
  ["map", "/map"],
  ["arena", "/arena"],
  ["forge", "/forge"],
  ["habits", "/habits"],
  ["plan", "/plan"],
  ["review", "/review"],
  ["character", "/character"],
];
const THEMES = ["night", "cream"];
const VIEW = { width: 1280, height: 800 };

const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password }) });
if (!login.ok) {
  console.error(`Login failed (${login.status}). Is the app running on ${base} with demo data (npm run demo:seed)?`);
  process.exit(1);
}
const cookies = login.headers.getSetCookie().map((c) => {
  const [pair] = c.split(";");
  const i = pair.indexOf("=");
  return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
});
const csrf = cookies.find((c) => c.name === "ascent_csrf")?.value ?? "";
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
await page.setCookie(...cookies);
await page.evaluateOnNewDocument(() => {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
});

const shots = {};
for (const theme of THEMES) {
  const res = await fetch(`${base}/api/prefs`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrf, cookie: cookieHeader }, body: JSON.stringify({ theme }) });
  if (!res.ok) throw new Error(`theme switch failed: ${res.status}`);
  for (const [name, route] of PAGES) {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle0", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 600));
    const file = path.join(out, `${name}-${theme}.webp`);
    const buf = await page.screenshot({ type: "webp", quality: 84 });
    fs.writeFileSync(file, buf);
    shots[`${name}-${theme}`] = buf;
    console.log(`${file}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

// ── composites: rendered by the browser itself, so no image dependency ────────────────────────────────────────
const uri = (key) => `data:image/webp;base64,${shots[key].toString("base64")}`;
const compose = async (file, width, height, html, type = "png") => {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}body{width:${width}px;height:${height}px;overflow:hidden;font-family:Inter,Segoe UI,system-ui,sans-serif;color:#fff}</style>${html}`);
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(file, await p.screenshot({ type, ...(type === "webp" ? { quality: 88 } : {}) }));
  await p.close();
  console.log(`${file}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
};

const frame = "border-radius:14px;box-shadow:0 30px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)";
await compose(
  path.join(out, "hero.webp"),
  1600,
  860,
  `<div style="position:relative;width:100%;height:100%;background:radial-gradient(1200px 700px at 20% 0%,#2a2350 0%,#12121c 55%,#0b0b12 100%)">
     <img src="${uri("today-cream")}" style="position:absolute;right:50px;top:96px;width:900px;${frame};transform:rotate(1.2deg)">
     <img src="${uri("today-night")}" style="position:absolute;left:50px;top:56px;width:960px;${frame};transform:rotate(-1deg)">
   </div>`,
  "webp",
);
await compose(
  path.join(out, "social-preview.png"),
  1280,
  640,
  `<div style="position:relative;width:100%;height:100%;background:radial-gradient(900px 560px at 10% 0%,#2f2760 0%,#12121c 60%,#0b0b12 100%)">
     <div style="position:absolute;left:64px;top:150px;width:470px">
       <div style="font:700 22px Segoe UI,system-ui;letter-spacing:.28em;color:#f5c04a">OPEN SOURCE</div>
       <div style="font:800 76px/1.02 Segoe UI,system-ui;margin-top:14px">THE ASCENT</div>
       <div style="font:400 27px/1.35 Segoe UI,system-ui;margin-top:22px;color:#cfd0e6">A self-hosted study &amp; habit engine that treats your exam like a game you can win.</div>
       <div style="font:600 19px Segoe UI,system-ui;margin-top:30px;color:#8f92b8">Next.js · PostgreSQL · MIT</div>
     </div>
     <img src="${uri("today-night")}" style="position:absolute;left:600px;top:70px;width:760px;${frame};transform:rotate(-1.5deg)">
   </div>`,
);

await browser.close();
console.log("\nDone. Commit docs/images/* — and upload social-preview.png in the repository Settings → Social preview.");
