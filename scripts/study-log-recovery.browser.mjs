// Browser regression for the study-log lost-response recovery path.
// Run against a disposable local app after `scripts/smoke.mjs` creates the smoke account.
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const base = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const username = process.env.SMOKE_USER ?? "smoke";
const password = process.env.SMOKE_PASSWORD ?? "smoke-test-password-123";
const host = new URL(base).hostname;
const isPrivate =
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "[::1]" ||
  host.endsWith(".localhost") ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
  !host.includes(".");
if (!isPrivate) throw new Error(`Refusing to run a data-writing browser test against ${host}`);

const executablePath =
  process.env.CHROME_PATH ??
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(existsSync);
if (!executablePath || !existsSync(executablePath))
  throw new Error("Set CHROME_PATH to a local Chrome or Edge executable");

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const nativeFetch = window.fetch.bind(window);
    const storagePrefix = "study-log-recovery-browser-v1:";
    let state = {
      lostSubmissionResponse: false,
      lostFirstReconciliation: false,
      requestId: "",
      originalSubmissionStatus: 0,
    };
    try {
      if (window.name.startsWith(storagePrefix)) {
        state = { ...state, ...JSON.parse(window.name.slice(storagePrefix.length)) };
      }
    } catch {
      // A malformed test marker should behave like a fresh browser run.
    }
    const persistState = () => {
      window.name = `${storagePrefix}${JSON.stringify(state)}`;
    };
    Object.assign(window, { __studyLogRecoveryTest: state });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname === "/api/study-logs" && method === "POST" && !state.lostSubmissionResponse) {
        const committedResponse = await nativeFetch(input, init);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        state.requestId = body.clientRequestId ?? "";
        state.originalSubmissionStatus = committedResponse.status;
        state.lostSubmissionResponse = true;
        persistState();
        if (!committedResponse.ok) return committedResponse;
        return new Response(
          JSON.stringify({ error: { code: "simulated_lost_response", message: "simulated" } }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.pathname === "/api/study-logs" &&
        method === "GET" &&
        url.searchParams.has("requestIds") &&
        !state.lostFirstReconciliation
      ) {
        state.lostFirstReconciliation = true;
        persistState();
        return new Response(
          JSON.stringify({ error: { code: "simulated_reconciliation_outage", message: "simulated" } }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return await nativeFetch(input, init);
    };
  });

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("form button[type=submit], form button").click(),
  ]);
  await page.goto(`${base}/study-log`, { waitUntil: "networkidle0" });

  const topic = `Recovery browser ${Date.now()}`;
  const sourceText =
    "BROWSER_PRIVATE_SOURCE_MARKER: a stable request identity survives reload without storing these notes.";
  await page.locator('input[placeholder="e.g. Breadth-first search"]').fill(topic);
  await page.locator("textarea").fill(sourceText);
  await page.locator('input[type="checkbox"]').click();
  await page.locator("form button").click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="alert"]')].some((node) =>
        node.textContent?.includes("connection ended before the save was confirmed"),
      ),
    { timeout: 30_000 },
  );

  const beforeReload = await page.evaluate(() => ({
    raw: sessionStorage.getItem("study-log.recovery.v1"),
    testState: window.__studyLogRecoveryTest,
  }));
  if (!beforeReload.raw || beforeReload.raw.includes(sourceText) || beforeReload.raw.includes("sourceText"))
    throw new Error("Recovery storage contains private study material or no request marker");
  const marker = JSON.parse(beforeReload.raw);
  if (
    marker.length !== 1 ||
    marker[0]?.kind !== "submission" ||
    marker[0]?.clientRequestId !== beforeReload.testState?.requestId
  ) {
    throw new Error("The browser did not persist the original submission identity");
  }
  if (!beforeReload.testState?.lostSubmissionResponse || !beforeReload.testState.lostFirstReconciliation) {
    throw new Error("The browser test did not simulate both lost responses");
  }
  if (beforeReload.testState.originalSubmissionStatus !== 200) {
    throw new Error(
      `The server did not confirm the original submission (${beforeReload.testState.originalSubmissionStatus})`,
    );
  }

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    (expectedSource) => {
      const details = [...document.querySelectorAll("pre")].some(
        (node) => node.textContent === expectedSource,
      );
      return sessionStorage.getItem("study-log.recovery.v1") === null && details;
    },
    { timeout: 30_000 },
    sourceText,
  );
  console.log("PASS  browser reload reconciles a committed study submission without storing its source text");
} finally {
  await browser.close();
}
