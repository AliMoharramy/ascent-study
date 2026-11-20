// Generates public/icons/icon-192.png from icon-512.png (nearest-neighbour downscale, no new deps).
// Run: node scripts/gen-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const src = PNG.sync.read(fs.readFileSync(path.join("public", "icons", "icon-512.png")));
const size = 192;
const out = new PNG({ width: size, height: size });
const scale = src.width / size;
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const sx = Math.min(src.width - 1, Math.floor(x * scale));
    const sy = Math.min(src.height - 1, Math.floor(y * scale));
    const si = (sy * src.width + sx) * 4;
    const di = (y * size + x) * 4;
    out.data[di] = src.data[si];
    out.data[di + 1] = src.data[si + 1];
    out.data[di + 2] = src.data[si + 2];
    out.data[di + 3] = src.data[si + 3];
  }
}
fs.writeFileSync(path.join("public", "icons", "icon-192.png"), PNG.sync.write(out));
console.log("wrote public/icons/icon-192.png");