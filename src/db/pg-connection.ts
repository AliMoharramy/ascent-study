import type { ClientConfig } from "pg";

export function parseDatabaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
    // Query-string overrides must not bypass host-based TLS/direct-connection checks.
    for (const key of ["host", "hostaddr", "port", "user", "password", "database", "service"]) {
      if (url.searchParams.has(key)) throw new Error();
    }
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    throw new Error("A valid PostgreSQL connection URL is required");
  }
}

export function isLocalDatabase(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
}

/**
 * Hosts that cannot be reached over the public internet: loopback, single-label names (Docker/Compose service names
 * such as `postgres`) and RFC1918 addresses. Public DNS names always contain a dot, so a real provider hostname never
 * qualifies. Only these may skip TLS; every other host requires verified TLS.
 */
export function isPrivateNetworkHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (isLocalDatabase(url)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return !host.includes(".") && !host.includes(":");
}

export function requireDirectConnection(value: string): string {
  const url = parseDatabaseUrl(value);
  if (/pooler|pgbouncer/i.test(url.hostname) || ["6432", "6543"].includes(url.port) || url.searchParams.has("pgbouncer")) {
    throw new Error("PostgreSQL migrations require a direct connection, never a transaction pooler");
  }
  return value;
}

/** Remove pg URL SSL overrides; remote peers must always be authenticated. */
export function pgConnectionOptions(value: string): ClientConfig {
  const url = parseDatabaseUrl(value);
  const mode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  const local = isPrivateNetworkHost(url);
  if (!local && (mode === "disable" || mode === "no-verify" || ssl === "0" || ssl === "false")) {
    throw new Error("Remote PostgreSQL requires verified TLS");
  }
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error("PostgreSQL TLS file overrides are not supported; use a trusted CA");
  }
  const useTls = !local || (!!mode && mode !== "disable") || ssl === "true" || ssl === "1";
  for (const key of ["sslmode", "ssl", "uselibpqcompat", "sslnegotiation"]) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: useTls ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10_000,
  };
}

class SafePgError extends Error {}

/** Keep only a diagnostic code, never SQL, server messages, parameters or connection details. */
export function safePgError(error: unknown, context = "PostgreSQL operation failed"): Error {
  if (error instanceof SafePgError) return error;
  let code: string | undefined;
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = "code" in current ? current.code : undefined;
    if (typeof candidate === "string" && (/^[0-9A-Z]{5}$/.test(candidate) || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(candidate))) {
      code = candidate;
      break;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  const result = new SafePgError(code ? `${context} (${code})` : context);
  if (code) Object.assign(result, { code });
  return result;
}
