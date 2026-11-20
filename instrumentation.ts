/** Register local cron callbacks only; cold starts never connect to the database. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL !== "1" && process.env.DISABLE_JOBS !== "true") {
    const { boot } = await import("./src/jobs/boot");
    await boot();
  }
}
