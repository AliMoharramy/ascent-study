// Initial-JS budget gate (#110, NFR-02): the /today route must ship ≤ 200 KB gzip of JavaScript.
// Run after `npm run build`: node scripts/perf-budget.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUDGET_KB = 200;
const manifestPath = path.join(".next", "app-build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("No .next/app-build-manifest.json — run `npm run build` first.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = new Set();
for (const key of ["/layout", "/today/page"]) {
  for (const f of manifest.pages[key] ?? []) if (f.endsWith(".js")) files.add(f);
}
if (files.size === 0) {
  console.error("No JS entries found for /today — manifest keys:", Object.keys(manifest.pages).join(", "));
  process.exit(1);
}
let total = 0;
const rows = [];
for (const f of [...files].sort()) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join(".next", f)), { level: 9 }).length;
  total += gz;
  rows.push({ file: f, gzipKB: (gz / 1024).toFixed(1) });
}
console.table(rows);
console.log(`Initial JS for /today: ${(total / 1024).toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB * 1024) {
  console.error("BUDGET EXCEEDED");
  process.exit(1);
}
console.log("Budget OK");