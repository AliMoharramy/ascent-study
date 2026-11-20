import { z } from "zod";
import { ApiError, api, body } from "@/server/http";
import { csvRows, ensureDefaultConfig, getConfigVersion, importConfig, listConfigVersions, parseCsvRows, rollbackConfig, unknownConfigPaths, updateConfig } from "@/server/config";

export const GET = api(async ({ db, userId, req }) => {
  const active = (await ensureDefaultConfig(db, userId));
  const version = Number(new URL(req.url).searchParams.get("version") ?? "");
  if (Number.isInteger(version) && version > 0) {
    const found = (await getConfigVersion(db, userId, version));
    if (!found) throw new ApiError(404, "not_found", `Unknown config version v${version}`);
    return { active: found, csv: csvRows(found.config) };
  }
  return { active, csv: csvRows(active.config), versions: (await listConfigVersions(db, userId)).map(({ version: v, reason, createdAt }) => ({ version: v, reason, createdAt })) };
});

const reason = z.string().min(3).max(300);
const input = z.union([
  z.object({ action: z.literal("rollback"), version: z.number().int().min(1), reason }),
  z.object({ action: z.literal("import"), format: z.enum(["json", "csv"]), data: z.string().min(1).max(200_000), reason }),
  z.object({ patch: z.record(z.string(), z.unknown()), reason }),
]);

export const PUT = api(async ({ db, userId, req }) => {
  const parsed = input.parse(await body(req));
  const active = (await ensureDefaultConfig(db, userId));
  if ("action" in parsed && parsed.action === "rollback") return { active: (await rollbackConfig(db, userId, parsed.version, parsed.reason)) };
  if ("action" in parsed && parsed.action === "import") {
    let raw: unknown;
    if (parsed.format === "csv") raw = parseCsvRows(parsed.data);
    else {
      try {
        raw = JSON.parse(parsed.data);
      } catch {
        throw new ApiError(400, "bad_json", "Imported file is not valid JSON");
      }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "validation", "Config must be a JSON object");
    const unknown = unknownConfigPaths(active.config, raw);
    if (unknown.length) throw new ApiError(400, "validation", `Unknown config path: ${unknown.slice(0, 3).join(", ")}`);
    return { active: (await importConfig(db, userId, raw, parsed.reason)) };
  }
  const unknown = unknownConfigPaths(active.config, parsed.patch);
  if (unknown.length) throw new ApiError(400, "validation", `Unknown config path: ${unknown.slice(0, 3).join(", ")}`);
  return { active: (await updateConfig(db, userId, parsed.patch, parsed.reason)) };
});
