import fs from "node:fs";
import path from "node:path";

/**
 * Art batch-1 validator (issue #10). Checks the 27 assets from docs/art-brief.md against the
 * spec: exact file name, format (webp/png), source dimensions, and WebP size cap.
 * Missing files are reported (the user generates them with Gemini/Nano Banana) but do not fail;
 * a PRESENT file that violates the spec fails the run. Dependency-free PNG/WebP header parsing.
 */

type Spec = { file: string; w: number; h: number; maxKb: number };

const SPECS: Spec[] = [
  ...(["idle", "happy", "thinking", "celebrate", "tired"] as const).map((s) => ({ file: `art/hero/hero-${s}.webp`, w: 1024, h: 1024, maxKb: 120 })),
  ...(["smug", "winner", "defeated"] as const).map((s) => ({ file: `art/shade/shade-${s}.webp`, w: 1024, h: 1024, maxKb: 120 })),
  ...(["reading", "thinking", "cheering", "warning"] as const).map((s) => ({ file: `art/archie/archie-${s}.webp`, w: 1024, h: 1024, maxKb: 120 })),
  { file: "art/map/world-map.webp", w: 2400, h: 1600, maxKb: 450 },
  ...([1, 2, 3, 4] as const).map((n) => ({ file: `art/realms/realm-${n}.webp`, w: 1600, h: 900, maxKb: 250 })),
  ...(["study", "run", "sleep", "read", "idea", "duel", "celebrate", "calm"] as const).map((s) => ({ file: `art/scenes/scene-${s}.webp`, w: 1200, h: 900, maxKb: 160 })),
  { file: "art/fog/fog-weekly.webp", w: 1024, h: 1024, maxKb: 120 },
  { file: "icons/icon-512.png", w: 512, h: 512, maxKb: 60 },
];

function dimensions(buf: Buffer): { w: number; h: number; format: string } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), format: "png" };
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = buf.toString("ascii", 12, 16);
    const d = buf.subarray(20);
    if (fourcc === "VP8X" && d.length >= 10) {
      return { w: (d[4]! | (d[5]! << 8) | (d[6]! << 16)) + 1, h: (d[7]! | (d[8]! << 8) | (d[9]! << 16)) + 1, format: "webp" };
    }
    if (fourcc === "VP8L" && d.length >= 5 && d[0] === 0x2f) {
      const u = d.readUInt32LE(1);
      return { w: (u & 0x3fff) + 1, h: ((u >> 14) & 0x3fff) + 1, format: "webp" };
    }
    if (fourcc === "VP8 " && d.length >= 10 && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a) {
      return { w: d.readUInt16LE(6) & 0x3fff, h: d.readUInt16LE(8) & 0x3fff, format: "webp" };
    }
  }
  return null;
}

const root = path.join(process.cwd(), "public");
let present = 0;
let missing = 0;
let bad = 0;

for (const s of SPECS) {
  const p = path.join(root, s.file);
  if (!fs.existsSync(p)) {
    missing += 1;
    console.log(`… missing  ${s.file}  (user generates — see docs/art-brief.md)`);
    continue;
  }
  present += 1;
  const buf = fs.readFileSync(p);
  const kb = buf.length / 1024;
  const dim = dimensions(buf);
  const problems: string[] = [];
  const wantFormat = s.file.endsWith(".png") ? "png" : "webp";
  if (!dim) problems.push("unreadable header (not png/webp?)");
  else {
    if (dim.format !== wantFormat) problems.push(`format ${dim.format}, want ${wantFormat}`);
    if (dim.w !== s.w || dim.h !== s.h) problems.push(`dims ${dim.w}×${dim.h}, want ${s.w}×${s.h}`);
  }
  if (kb > s.maxKb) problems.push(`size ${kb.toFixed(0)}KB > ${s.maxKb}KB`);
  if (problems.length) {
    bad += 1;
    console.log(`✗ INVALID  ${s.file}  — ${problems.join("; ")}`);
  } else {
    console.log(`✓ ok       ${s.file}  ${dim!.w}×${dim!.h} ${kb.toFixed(0)}KB`);
  }
}

const ref = path.join(root, "art/reference/hero-idle-reference.png");
console.log(fs.existsSync(ref) ? "✓ style reference present (art/reference/hero-idle-reference.png)" : "… style reference missing (issue #9)");

console.log(`\n${present} present, ${missing} missing, ${bad} invalid (of ${SPECS.length} batch-1 assets).`);
if (bad > 0) {
  console.error("Present assets violate the spec — fix names/dimensions/size before closing #10.");
  process.exit(1);
}
console.log(missing > 0 ? "Batch pending: drop the generated files into public/ and re-run." : "All batch-1 assets present and valid.");