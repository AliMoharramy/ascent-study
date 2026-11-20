export const dynamic = "force-dynamic";

/** Process liveness only: health probes must not wake a suspended Neon database. */
export function GET() {
  return Response.json({ status: "ok", db: null, time: new Date().toISOString() });
}
