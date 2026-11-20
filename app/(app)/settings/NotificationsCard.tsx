"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";

type V = {
  push: { enabled: boolean; publicKey: string; devices: number };
  telegram: { enabled: boolean; chatId: string; tokenSet: boolean };
  reminders: { enabled: boolean; tone: string; maxPerDay: number };
};

function urlKey(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Notifications card (#109): web push + Telegram, both strictly opt-in, with a one-tap test. */
export function NotificationsCard() {
  const [v, setV] = useState<V | null>(null);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<V>("/api/notify")
      .then((r) => {
        setV(r);
        setChatId(r.telegram.chatId);
      })
      .catch(() => setNote("Could not load notification settings"));
  }, []);

  async function patchConfig(patch: unknown) {
    await apiFetch("/api/config", { method: "PUT", body: { patch, reason: "notifications opt-in/out (#109)" } });
  }

  async function togglePush() {
    if (!v) return;
    setBusy(true);
    setNote(null);
    try {
      if (v.push.enabled) {
        await patchConfig({ notifications: { push: { enabled: false } } });
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await apiFetch("/api/notify", { body: { action: "unsubscribe", endpoint: sub.endpoint } });
          await sub.unsubscribe();
        }
        setV({ ...v, push: { ...v.push, enabled: false, devices: 0 } });
        setNote("Push turned off.");
      } else {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("This browser does not support push");
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("Notification permission was not granted");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(v.push.publicKey) });
        const j = sub.toJSON();
        const r = await apiFetch<V>("/api/notify", { body: { action: "subscribe", subscription: { endpoint: j.endpoint, keys: j.keys } } });
        await patchConfig({ notifications: { push: { enabled: true } } });
        setV({ ...r, push: { ...r.push, enabled: true } });
        setNote("Push enabled on this device.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Push setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveTelegram(enable: boolean) {
    if (!v) return;
    setBusy(true);
    setNote(null);
    try {
      await patchConfig({ notifications: { telegram: { enabled: enable, chatId: chatId.trim() } } });
      setV({ ...v, telegram: { ...v.telegram, enabled: enable, chatId: chatId.trim() } });
      setNote(enable ? "Telegram reminders enabled." : "Telegram turned off.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<{ push: { sent: number }; telegram: { sent: boolean; reason?: string } }>("/api/notify", { body: { action: "test" } });
      setNote(`Test sent — push: ${r.push.sent} device(s), telegram: ${r.telegram.sent ? "ok" : (r.telegram.reason ?? "not configured")}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  if (!v) return null;
  return (
    <Card className="md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Notifications · opt-in · gentle tone</Eyebrow>
        <button type="button" className="btn-ghost py-2" onClick={test} disabled={busy}>
          <Icon name="bell" size={16} /> Send test
        </button>
      </div>
      <p className="mt-2 text-body-s text-muted">
        The same anchor reminders the bell shows, delivered to your browser or Telegram. Capped at {v.reminders.maxPerDay}/day; browser permission is required for Push and a token plus chat id for Telegram.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <b className="text-body-s">Web push · {v.push.devices} device(s)</b>
            <button type="button" role="switch" aria-checked={v.push.enabled} onClick={togglePush} disabled={busy} className={`btn py-1.5 ${v.push.enabled ? "bg-mint text-on-color" : "border border-line text-ink"}`}>
              {v.push.enabled ? "On" : "Off"}
            </button>
          </div>
          <p className="mt-1 text-caption text-muted">Enabling asks for browser permission and registers this device.</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <b className="text-body-s">Telegram {v.telegram.tokenSet ? "" : "· bot token not set"}</b>
            <button type="button" role="switch" aria-checked={v.telegram.enabled} onClick={() => saveTelegram(!v.telegram.enabled)} disabled={busy || !v.telegram.tokenSet} className={`btn py-1.5 ${v.telegram.enabled ? "bg-mint text-on-color" : "border border-line text-ink"}`}>
              {v.telegram.enabled ? "On" : "Off"}
            </button>
          </div>
          <label className="mt-2 grid gap-1 text-caption font-extrabold text-muted">
            Chat id (message the bot, then paste your id)
            <input className="field" dir="ltr" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" maxLength={40} />
          </label>
          <button type="button" className="btn-ghost mt-2 py-1.5" onClick={() => saveTelegram(v.telegram.enabled)} disabled={busy || !v.telegram.tokenSet}>
            Save chat id
          </button>
          <p className="mt-1 text-caption text-muted">Quick capture: /test 8 2 0 logs a test, /idea … parks an idea. Run: npm run telegram:bot</p>
        </div>
      </div>
      {note && (
        <p role="status" className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-body-s font-semibold">
          {note}
        </p>
      )}
    </Card>
  );
}
