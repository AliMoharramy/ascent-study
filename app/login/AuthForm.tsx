"use client";

import { useState } from "react";
import { Icon } from "@/ui/icons";

export function AuthForm({ mode, next, setupTokenRequired = false }: { mode: "login" | "setup"; next: string; setupTokenRequired?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload = Object.fromEntries(f.entries()) as Record<string, string>;
    try {
      if (mode === "setup") {
        if (payload.password !== payload.confirm) throw new Error("Passwords do not match");
        const r = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: payload.username, name: payload.name, password: payload.password, setupToken: payload.setupToken || undefined }) });
        if (!r.ok) throw new Error(((await r.json()) as { error?: { message: string } }).error?.message ?? "Setup failed");
      }
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: payload.username, password: payload.password }) });
      if (!r.ok) throw new Error(((await r.json()) as { error?: { message: string } }).error?.message ?? "Sign-in failed");
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input id="username" name="username" className="field" autoComplete="username" required autoFocus />
      </div>
      {mode === "setup" && (
        <div>
          <label className="label" htmlFor="name">Display name</label>
          <input id="name" name="name" className="field" dir="auto" required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="field" autoComplete={mode === "setup" ? "new-password" : "current-password"} minLength={mode === "setup" ? 10 : 1} required />
      </div>
      {mode === "setup" && (
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" className="field" autoComplete="new-password" minLength={10} required />
        </div>
      )}
      {mode === "setup" && setupTokenRequired && (
        <div>
          <label className="label" htmlFor="setupToken">Setup token</label>
          <input id="setupToken" name="setupToken" type="password" className="field" autoComplete="off" required />
          <p className="mt-1 text-caption text-muted">The value of the <code>SETUP_TOKEN</code> environment variable on this server.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-coral/15 px-4 py-2 text-body-s font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <button className="btn-accent mt-1 w-full py-3" disabled={busy}>
        {busy ? "…" : mode === "setup" ? "Create account" : "Enter"} <Icon name="arrow" size={18} />
      </button>
    </form>
  );
}
