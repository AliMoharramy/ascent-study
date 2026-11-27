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
      submissionRequestIds: [],
      submissionLogIds: [],
      delayNextReconciliation: false,
      reconciliationDelayStarted: false,
      reconciliationDelayCompleted: false,
      retryRequestId: "",
      retryLogPath: "",
      retryPostAttempted: false,
      retryDetailStatus: "",
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
    Object.assign(window, {
      __studyLogRecoveryTest: state,
      __studyLogRecoveryPersistTest: persistState,
    });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname === "/api/study-logs" && method === "POST") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const committedResponse = await nativeFetch(input, init);
        const committedBody = await committedResponse
          .clone()
          .json()
          .catch(() => ({}));
        state.submissionRequestIds.push(body.clientRequestId ?? "");
        state.submissionLogIds.push(committedBody?.log?.id ?? "");
        if (!state.lostSubmissionResponse) {
          state.requestId = body.clientRequestId ?? "";
          state.originalSubmissionStatus = committedResponse.status;
          state.lostSubmissionResponse = true;
        }
        persistState();
        if (!committedResponse.ok) return committedResponse;
        if (state.submissionRequestIds.length === 1) {
          return new Response(
            JSON.stringify({ error: { code: "simulated_lost_response", message: "simulated" } }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return committedResponse;
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
      if (
        url.pathname === "/api/study-logs" &&
        method === "GET" &&
        url.searchParams.has("requestIds") &&
        state.delayNextReconciliation
      ) {
        state.delayNextReconciliation = false;
        state.reconciliationDelayStarted = true;
        persistState();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        state.reconciliationDelayCompleted = true;
        persistState();
      }
      if (method === "POST" && /^\/api\/study-logs\/[^/]+\/retry$/.test(url.pathname)) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        state.retryRequestId = body.clientRequestId ?? "";
        state.retryLogPath = url.pathname.replace(/\/retry$/, "");
        state.retryPostAttempted = true;
        persistState();
        return new Response(
          JSON.stringify({ error: { code: "simulated_lost_retry_response", message: "simulated" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      const response = await nativeFetch(input, init);
      if (state.retryPostAttempted && method === "GET" && url.pathname === state.retryLogPath) {
        const detail = await response
          .clone()
          .json()
          .catch(() => ({}));
        state.retryDetailStatus = detail?.log?.status ?? "";
        persistState();
      }
      return response;
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
  const studiedOn = await page.evaluate(() => document.querySelector('input[type="date"]')?.value ?? "");
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

  await page.evaluate(() => {
    window.__studyLogRecoveryTest.delayNextReconciliation = true;
    window.__studyLogRecoveryPersistTest();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__studyLogRecoveryTest?.reconciliationDelayStarted, {
    timeout: 30_000,
  });
  await page.locator('input[placeholder="e.g. Breadth-first search"]').fill(topic);
  await page.locator("textarea").fill(sourceText);
  await page.locator('input[type="date"]').fill(studiedOn);
  await page.locator('input[type="checkbox"]').click();
  await page.locator("form button").click();
  await page.waitForFunction(
    () => {
      const state = window.__studyLogRecoveryTest;
      return state?.submissionRequestIds?.length === 2 && !state.reconciliationDelayCompleted;
    },
    { timeout: 30_000 },
  );
  const racedSubmission = await page.evaluate(() => window.__studyLogRecoveryTest);
  if (
    racedSubmission.submissionRequestIds[0] !== racedSubmission.submissionRequestIds[1] ||
    racedSubmission.submissionLogIds[0] !== racedSubmission.submissionLogIds[1]
  ) {
    throw new Error("Submitting while reload reconciliation was delayed created a second logical study log");
  }

  await page.waitForFunction(() => window.__studyLogRecoveryTest?.reconciliationDelayCompleted, {
    timeout: 30_000,
  });
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

  const retryTextarea = page.locator('section[aria-labelledby="history-heading"] textarea');
  await retryTextarea.fill(sourceText);
  await page.locator('section[aria-labelledby="history-heading"] input[type="checkbox"]').click();
  await page.locator('section[aria-labelledby="history-heading"] li button.btn-accent').click();
  await page.waitForFunction(
    () =>
      window.__studyLogRecoveryTest?.retryPostAttempted && window.__studyLogRecoveryTest.retryDetailStatus,
    { timeout: 30_000 },
  );
  const ambiguousRetry = await page.evaluate(() => ({
    state: window.__studyLogRecoveryTest,
    recovery: sessionStorage.getItem("study-log.recovery.v1"),
  }));
  const retryMarker = JSON.parse(ambiguousRetry.recovery ?? "[]").find(
    (marker) =>
      marker.kind === "retry" && marker.studyLogId === ambiguousRetry.state.retryLogPath.split("/").at(-1),
  );
  if (
    !["retryable", "needs_material"].includes(ambiguousRetry.state.retryDetailStatus) ||
    retryMarker?.clientRequestId !== ambiguousRetry.state.retryRequestId ||
    ambiguousRetry.recovery?.includes(sourceText) ||
    ambiguousRetry.recovery?.includes("sourceText")
  ) {
    throw new Error(
      "A stale detail response cleared/replaced the retry identity or recovery storage contains private study text",
    );
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Retry with saved ID"),
      ),
    { timeout: 30_000 },
  );
  const restoredRetryId = await page.evaluate(() => {
    const state = window.__studyLogRecoveryTest;
    const markers = JSON.parse(sessionStorage.getItem("study-log.recovery.v1") ?? "[]");
    return {
      expected: state.retryRequestId,
      marker: markers.find((item) => item.kind === "retry")?.clientRequestId,
    };
  });
  if (restoredRetryId.marker !== restoredRetryId.expected) {
    throw new Error("The ambiguous analysis retry identity did not survive a reload");
  }
  console.log(
    "PASS  delayed submission reconciliation reuses the original key; ambiguous retry identity survives stale detail and reload",
  );
} finally {
  await browser.close();
}
