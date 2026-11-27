// node scripts/smoke.mjs <base-url>   (npm run smoke -- http://localhost:3100)
//
// Page-level smoke test against a RUNNING app on a DISPOSABLE database: creates the account, completes onboarding and
// opens every page and the main APIs. Unit/integration tests never render pages, so SQL that only breaks inside one
// page (e.g. a boolean compared to an integer) is caught here instead of in production.
//
// Safety: it creates data, so it only talks to localhost / private-network hosts and refuses everything else.

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const host = new URL(base).hostname;
const isPrivate = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost") ||
  /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes(".");
if (!isPrivate) {
  console.error(`Refusing to run against ${host}: the smoke test creates an account and data. Use a local or CI instance.`);
  process.exit(2);
}

const USER = process.env.SMOKE_USER ?? "smoke";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "smoke-test-password-123";
const jar = new Map();
let failures = 0;

function remember(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function call(path, init = {}) {
  const headers = { cookie: cookieHeader(), ...(init.headers ?? {}) };
  if (init.method && init.method !== "GET" && jar.has("ascent_csrf")) headers["x-csrf-token"] = decodeURIComponent(jar.get("ascent_csrf"));
  const res = await fetch(base + path, { redirect: "manual", ...init, headers, signal: AbortSignal.timeout(90_000) });
  remember(res);
  return res;
}
const json = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// 1) first-run setup (409 = already created by a previous run), login, onboarding
const setup = await json("/api/setup", { username: USER, name: "Smoke", password: PASSWORD, ...(process.env.SETUP_TOKEN ? { setupToken: process.env.SETUP_TOKEN } : {}) });
check("first-run setup", setup.status === 200 || setup.status === 409, `HTTP ${setup.status}`);
const login = await json("/api/auth/login", { username: USER, password: PASSWORD });
check("login", login.status === 200, `HTTP ${login.status}`);
if (login.status !== 200) process.exit(1);
check("onboarding", (await json("/api/reviews", { action: "onboarding" })).status === 200);

// 2) every page must render (no 5xx, no redirect loop to /login)
const pages = ["/today", "/plan", "/map", "/courses", "/study-log", "/deck", "/forge", "/habits", "/ideas", "/life", "/rest", "/review",
  "/run", "/settings", "/sheets", "/final", "/arena", "/arena/exam", "/baseline", "/character", "/coach", "/codex",
  "/report/monthly", "/focus", "/onboarding", "/map/ai-1", "/review?tab=monthly", "/life?tab=monthly"];
const courses = await call("/courses");
const courseId = (await courses.text()).match(/href="\/courses\/([A-Za-z0-9_-]+)"/)?.[1];
check("courses page links to a course", !!courseId);
if (courseId) pages.push(`/courses/${courseId}`);
for (const p of pages) {
  const res = await call(p);
  const redirected = res.status >= 300 && res.status < 400;
  check(`page ${p}`, res.status === 200 && !redirected, `HTTP ${res.status}${redirected ? ` → ${res.headers.get("location")}` : ""}`);
}
const forgeReview = await call("/forge?tab=review");
const forgeReviewHtml = await forgeReview.text();
check("Forge fixed study-review section", forgeReview.status === 200 && forgeReviewHtml.includes("Study-log reviews"), `HTTP ${forgeReview.status}`);

// 3) main read APIs and one write
for (const p of ["/api/tests", "/api/reviews", "/api/xp", "/api/plan", "/api/habits", "/api/quests", "/api/checkin", "/api/ideas", "/api/backups", "/api/study-logs"]) {
  const res = await call(p);
  check(`api GET ${p}`, res.status === 200, `HTTP ${res.status}`);
}
const write = await json("/api/tests", { correct: 6, wrong: 1, blank: 0, clientRequestId: `smoke-${Date.now()}` });
check("api POST /api/tests", write.status === 200, `HTTP ${write.status}`);
const studySource = "Breadth-first search uses a queue to visit vertices by distance.";
const studyWrite = await json("/api/study-logs", { topic: "Smoke study log", sourceText: studySource, clientRequestId: `smoke-study-${Date.now()}` });
const studyResult = await studyWrite.json().catch(() => ({}));
check("api POST /api/study-logs", studyWrite.status === 200 && !!studyResult.log?.id, `HTTP ${studyWrite.status}`);
if (studyResult.log?.id) {
  const studyDetail = await call(`/api/study-logs/${encodeURIComponent(studyResult.log.id)}`);
  const detailResult = await studyDetail.json().catch(() => ({}));
  check("api GET study-log detail", studyDetail.status === 200 && detailResult.log?.sourceText === studySource, `HTTP ${studyDetail.status}`);
}
for (const body of [{ action: "monthly", wins: "w", risks: "r", oneChange: "keep going" }]) {
  const res = await json("/api/reviews", body);
  check(`api POST /api/reviews ${body.action}`, res.status === 200, `HTTP ${res.status}`);
}
check("monthly review reads back", (await call("/report/monthly")).status === 200);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nsmoke test passed");
process.exit(failures ? 1 : 0);
