// npm run seed:validate — schema + invariant checks for docs/seed/*.yaml (issue: validate seed YAML in CI)
import { validateSeedDir } from "../src/server/seedValidate";

const report = validateSeedDir();
for (const f of report.files) {
  const status = f.errors.length ? "✗" : "✓";
  console.log(`${status} ${f.file}${f.summary ? ` — ${f.summary}` : ""}`);
  for (const e of f.errors) console.log(`    • ${e}`);
  for (const w of f.warnings) console.log(`    ! ${w}`);
}
if (report.files.some((f) => f.errors.length)) process.exit(1);
