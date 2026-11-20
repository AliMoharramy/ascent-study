import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, queryOne } from "@/db/client";
import { currentSession } from "@/server/http";
import { setupTokenRequired } from "@/server/setupToken";
import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentSession()) redirect("/today");
  const hasUser = ((await queryOne<{ n: number }>(getDb(), sql`SELECT count(*) AS n FROM users`))?.n ?? 0) > 0;
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/today";
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      <div className="grid w-full max-w-4xl gap-4 md:grid-cols-[1.1fr_1fr]">
        <section className="card-color relative overflow-hidden bg-yellow">
          <p className="text-caption font-extrabold uppercase tracking-[0.2em] opacity-70">Day 1 of the climb</p>
          <h1 className="mt-3 font-display text-display-xl uppercase leading-[0.9]">The<br />Ascent</h1>
          <p className="mt-4 max-w-xs text-body-s font-semibold opacity-80">One mission. The nearest boss. Nothing else on the screen.</p>
          <svg viewBox="0 0 200 120" className="pointer-events-none absolute -bottom-2 -right-4 w-64 opacity-90" aria-hidden="true">
            <path d="M0 120 L60 40 L90 75 L130 15 L200 120 Z" fill="rgb(17 17 20)" />
            <path d="M130 15 L118 34 L130 30 L142 36 Z" fill="rgb(245 242 234)" />
            <circle cx="160" cy="30" r="9" fill="rgb(232 85 63)" />
          </svg>
        </section>
        <section className="card">
          <h2 className="font-display text-title-l uppercase">{hasUser ? "Sign in" : "First-run setup"}</h2>
          <p className="mb-5 text-body-s text-muted">{hasUser ? "Single-user system. 5 wrong attempts lock sign-in for 15 minutes." : "Create the one and only account for this server."}</p>
          <AuthForm mode={hasUser ? "login" : "setup"} next={safeNext} setupTokenRequired={!hasUser && setupTokenRequired()} />
        </section>
      </div>
    </main>
  );
}
