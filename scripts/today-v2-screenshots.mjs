// Capture the Today command center in both themes at representative viewport widths.
// Run against a local disposable app with a demo or QA account:
//   node scripts/today-v2-screenshots.mjs --base http://localhost:3000 --out tests/visual/today-v2 --tag after
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = flag("--base", "http://localhost:3000").replace(/\/$/, "");
const out = path.resolve(flag("--out", "tests/visual/today-v2"));
const tag = flag("--tag", "after");
const user = process.env.QA_USER ?? "demo";
const password = process.env.QA_PASSWORD ?? "demo-password-123";
const browserPath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const themes = ["cream", "night"];
const viewports = [390, 768, 1280].map((width) => ({ width, height: 900 }));

const host = new URL(base).hostname;
if (!(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost"))) {
  throw new Error(`Refusing to change preferences on non-local host ${host}.`);
}

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: user, password }),
});
if (!login.ok) throw new Error(`Login failed (${login.status}); use a seeded local QA account.`);

const cookies = login.headers.getSetCookie().map((cookie) => {
  const [pair] = cookie.split(";");
  const index = pair.indexOf("=");
  return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
});
const csrf = cookies.find((cookie) => cookie.name === "ascent_csrf")?.value ?? "";
const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

fs.mkdirSync(path.join(out, tag), { recursive: true });
const browser = await puppeteer.launch({ executablePath: browserPath, headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
await page.setCookie(...cookies);
await page.evaluateOnNewDocument(() => {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
});

let failures = 0;
try {
  for (const theme of themes) {
    const preference = await fetch(`${base}/api/prefs`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": csrf, cookie: cookieHeader },
      body: JSON.stringify({ theme }),
    });
    if (!preference.ok) throw new Error(`Could not set ${theme} theme (${preference.status}).`);

    for (const viewport of viewports) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      await page.goto(`${base}/today`, { waitUntil: "networkidle0", timeout: 45_000 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));
      if (layout.content > layout.viewport) failures += 1;

      const file = path.join(out, tag, `today-${theme}-${viewport.width}.png`);
      await page.screenshot({ path: file, fullPage: true, type: "png" });
      console.log(`${layout.content <= layout.viewport ? "ok" : "OVERFLOW"} ${file} (${layout.viewport}×${layout.height})`);
    }
  }
} finally {
  await browser.close();
}

if (failures) throw new Error(`${failures} viewport(s) have horizontal overflow.`);
