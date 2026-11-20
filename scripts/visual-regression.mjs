// Visual regression (#108, F-CORE-12): screenshots of the main pages in both themes, compared
// against committed baselines with pixelmatch. Run against an isolated QA server:
//   node scripts/visual-regression.mjs --base http://localhost:3103 [--update]
// Env: CHROME_PATH (defaults to the standard Windows Chrome install), QA_USER/QA_PASSWORD.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3103";
const update = args.includes("--update");
const user = process.env.QA_USER ?? "test";
const password = process.env.QA_PASSWORD ?? "test-password-123";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGES = ["/today", "/map", "/arena", "/review", "/settings"];
const THEMES = ["night", "cream"];
const DIR = path.join("tests", "visual");
const MAX_DIFF_RATIO = 0.005; // 0.5 % of pixels — fonts/AA hinting tolerance

const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password }) });
if (!login.ok) {
  console.error(`Login failed (${login.status}) — is the QA server running with the dev user?`);
  process.exit(1);
}
const cookies = login.headers.getSetCookie().map((c) => {
  const [pair] = c.split(";");
  const idx = pair.indexOf("=");
  return { name: pair.slice(0, idx), value: pair.slice(idx + 1), url: base };
});
const csrf = cookies.find((c) => c.name === "ascent_csrf")?.value ?? "";

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await page.setCookie(...cookies);
// deterministic frames: no animations, no caret blink
await page.evaluateOnNewDocument(() => {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
});

let failures = 0;
for (const theme of THEMES) {
  const prefs = await fetch(`${base}/api/prefs`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrf, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") }, body: JSON.stringify({ theme }) });
  if (!prefs.ok) throw new Error(`theme switch failed: ${prefs.status}`);
  for (const p of PAGES) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 400));
    const shot = PNG.sync.read(await page.screenshot({ type: "png" }));
    const name = `${theme}${p.replaceAll("/", "-")}.png`;
    const baselinePath = path.join(DIR, name);
    if (update || !fs.existsSync(baselinePath)) {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(baselinePath, PNG.sync.write(shot));
      console.log(`${update ? "updated" : "created"} baseline ${name}`);
      continue;
    }
    const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
    if (baseline.width !== shot.width || baseline.height !== shot.height) {
      console.error(`FAIL ${name}: size changed (${baseline.width}x${baseline.height} → ${shot.width}x${shot.height})`);
      failures++;
      continue;
    }
    const diff = new PNG({ width: shot.width, height: shot.height });
    const n = pixelmatch(baseline.data, shot.data, diff.data, shot.width, shot.height, { threshold: 0.12 });
    const ratio = n / (shot.width * shot.height);
    if (ratio > MAX_DIFF_RATIO) {
      fs.mkdirSync(path.join(DIR, "diff"), { recursive: true });
      fs.writeFileSync(path.join(DIR, "diff", name), PNG.sync.write(diff));
      console.error(`FAIL ${name}: ${(ratio * 100).toFixed(2)}% pixels differ (limit ${MAX_DIFF_RATIO * 100}%) — diff saved`);
      failures++;
    } else {
      console.log(`ok   ${name} (${(ratio * 100).toFixed(3)}% diff)`);
    }
  }
}
await browser.close();
if (failures > 0) {
  console.error(`${failures} visual regression failure(s). Re-run with --update only after reviewing the diffs.`);
  process.exit(1);
}
console.log("Visual regression passed");