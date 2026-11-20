import { and, desc, eq } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { configVersions } from "@/db/schema";
import { DEFAULT_CONFIG, mergeConfig } from "@/config/defaults";
import type { GameConfig } from "@/config/schema";
import { configSchema } from "@/config/schema";
import { appendEvent } from "@/events/store";
import { replayAll } from "@/events/projections";
import { newId, nowIso } from "@/lib/ids";

/**
 * Config versions (T-R1-03 / F-CORE-09 base). Every change creates a new immutable version with a reason
 * and a `config.changed` event; replay can ask for any historical version.
 */

export interface ConfigVersion {
  version: number;
  config: GameConfig;
  reason: string;
  createdAt: string;
}

function row2version(r: typeof configVersions.$inferSelect): ConfigVersion {
  // older versions lack later sections → fill them from defaults (new rules never break old rows)
  return { version: r.version, config: mergeConfig(DEFAULT_CONFIG, JSON.parse(r.json)), reason: r.reason, createdAt: r.createdAt };
}

/** Ensures v1 (defaults from doc 04) exists for the user. Idempotent. */
export async function ensureDefaultConfig(db: Db, userId: string): Promise<ConfigVersion> {
  const existing = await getActiveConfig(db, userId);
  if (existing) return existing;
  return await insertVersion(db, userId, 1, DEFAULT_CONFIG, "v1 defaults from game design doc 04");
}

async function insertVersion(db: Db, userId: string, version: number, config: GameConfig, reason: string): Promise<ConfigVersion> {
  const createdAt = nowIso();
  await db.insert(configVersions).values({ id: newId(), userId, version, json: JSON.stringify(config), reason, createdAt });
  return { version, config, reason, createdAt };
}

export async function getActiveConfig(db: Db, userId: string): Promise<ConfigVersion | null> {
  const r = (await db.select().from(configVersions).where(eq(configVersions.userId, userId)).orderBy(desc(configVersions.version)).limit(1))[0];
  return r ? row2version(r) : null;
}

/** Current config, falling back to defaults (never throws for a fresh user). */
export async function currentConfig(db: Db, userId: string): Promise<GameConfig> {
  return (await getActiveConfig(db, userId))?.config ?? DEFAULT_CONFIG;
}

export async function getConfigVersion(db: Db, userId: string, version: number): Promise<ConfigVersion | null> {
  const r = (await db.select().from(configVersions).where(and(eq(configVersions.userId, userId), eq(configVersions.version, version))).limit(1))[0];
  return r ? row2version(r) : null;
}

/** The config that was active at a given instant (for replay with historical rules). */
export async function configAt(db: Db, userId: string, at: string): Promise<ConfigVersion | null> {
  const all = await listConfigVersions(db, userId);
  let found: ConfigVersion | null = null;
  for (const v of all) if (v.createdAt <= at) found = v;
  return found ?? all[0] ?? null;
}

export async function listConfigVersions(db: Db, userId: string): Promise<ConfigVersion[]> {
  return (await db.select().from(configVersions).where(eq(configVersions.userId, userId)).orderBy(configVersions.version)).map(row2version);
}

/** Applies a partial patch, validates, stores a new version and logs `config.changed` with the diff paths. */
export async function updateConfig(db: Db, userId: string, patch: unknown, reason: string): Promise<ConfigVersion> {
  if (!reason || reason.trim().length < 3) throw new Error("A reason is required for every config change");
  return await withUserTransaction(db, userId, async (tx) => {
    const active = await ensureDefaultConfig(tx, userId);
    const next = mergeConfig(active.config, patch);
    return await commitVersion(tx, userId, active, next, reason, {});
  });
}

/** Re-applies a historical version as a new version (F-CORE-09 rollback). History is never rewritten. */
export async function rollbackConfig(db: Db, userId: string, version: number, reason: string): Promise<ConfigVersion> {
  if (!reason || reason.trim().length < 3) throw new Error("A reason is required for every config change");
  return await withUserTransaction(db, userId, async (tx) => {
    const active = await ensureDefaultConfig(tx, userId);
    const target = await getConfigVersion(tx, userId, version);
    if (!target) throw new Error(`Unknown config version v${version}`);
    if (target.version === active.version) return active;
    const next = configSchema.parse(target.config);
    return await commitVersion(tx, userId, active, next, reason, { rollbackTo: target.version });
  });
}

/** Imports a full or partial JSON/CSV document; schema validation happens before anything is stored. */
export async function importConfig(db: Db, userId: string, raw: unknown, reason: string): Promise<ConfigVersion> {
  if (!reason || reason.trim().length < 3) throw new Error("A reason is required for every config change");
  return await withUserTransaction(db, userId, async (tx) => {
    const active = await ensureDefaultConfig(tx, userId);
    const next = mergeConfig(active.config, raw);
    return await commitVersion(tx, userId, active, next, reason, { imported: true });
  });
}

async function commitVersion(db: Db, userId: string, active: ConfigVersion, next: GameConfig, reason: string, extra: Record<string, unknown>): Promise<ConfigVersion> {
  const changed = diffPaths(active.config, next);
  if (changed.length === 0) return active;
  const v = await insertVersion(db, userId, active.version + 1, next, reason.trim());
  await appendEvent(db, { userId, type: "config.changed", payload: { from: active.version, to: v.version, reason: v.reason, changed, ...extra }, configVersion: v.version, source: "system" });
  // ledgers always reflect the current rules → recompute them (doc 07 §4.3)
  if (changed.some((p) => /^(xp|score|gold|levels)\./.test(p))) await replayAll(db, userId);
  return v;
}

/** Flattens the active config into `path,value` rows (CSV export of editable constants). Arrays stay JSON. */
export function csvRows(config: GameConfig): [string, string][] {
  const walk = (v: unknown, path: string): [string, string][] => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => walk(x, path ? `${path}.${k}` : k));
    return [[path, Array.isArray(v) ? JSON.stringify(v) : String(v)]];
  };
  return walk(config, "");
}

/** Parses `path,value` rows back into a nested patch. Values use JSON when possible (`true`, `0.65`, `[1,3]`). */
export function parseCsvRows(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^path\s*,/.test(line.trim())) continue;
    const comma = line.indexOf(",");
    if (comma < 1) throw new Error(`Invalid CSV row: ${line.slice(0, 40)}`);
    const path = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // plain text (e.g. "05:30", "Asia/Tehran") stays a string
    }
    let at = root;
    const keys = path.split(".");
    const last = keys[keys.length - 1];
    if (!last) throw new Error(`Invalid CSV key: ${path}`);
    if (keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) throw new Error(`Invalid CSV key: ${path}`);
    for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
    at[last] = value;
  }
  return root;
}

/** Leaf paths in `patch` that do not exist in `base` — Zod would silently strip them instead of failing. */
export function unknownConfigPaths(base: unknown, patch: unknown, prefix = ""): string[] {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return [];
  if (!base || typeof base !== "object" || Array.isArray(base)) return [prefix || "(root)"];
  return Object.entries(patch as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (!(k in (base as Record<string, unknown>))) return [path];
    if (v && typeof v === "object" && !Array.isArray(v)) return unknownConfigPaths((base as Record<string, unknown>)[k], v, path);
    return [];
  });
}

export function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return [prefix || "(root)"];
}
