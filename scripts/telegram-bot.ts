// Telegram quick-capture bot (#109, F-INT-01). Long-polling, no webhook, no extra deps.
// Run: TELEGRAM_BOT_TOKEN=… npm run telegram:bot
// Commands (only from the chat id saved in Settings → Notifications):
//   /test <correct> <wrong> [blank]   → logs a test on today's game day
//   /idea <text>                      → parks an idea in the Vault
//   /start                            → help
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { currentConfig } from "../src/server/config";
import { parkIdea } from "../src/server/ideas";
import { logTest } from "../src/server/tests";
import { netPct } from "../src/domain/tests";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set — create a bot with @BotFather first.");
  process.exit(1);
}
const api = `https://api.telegram.org/bot${token}`;
const db = getDb();

async function userForChat(chatId: string): Promise<{ id: string; tz: string; rolloverHour: number } | null> {
  for (const u of await db.select().from(users)) {
    const cfg = await currentConfig(db, u.id);
    if (cfg.notifications.telegram.enabled && cfg.notifications.telegram.chatId === chatId) return { id: u.id, tz: u.timezone, rolloverHour: u.rolloverHour };
  }
  return null;
}

async function send(chatId: number | string, text: string) {
  await fetch(`${api}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
}

async function handle(msg: { chat: { id: number }; text?: string }) {
  const text = (msg.text ?? "").trim();
  const user = await userForChat(String(msg.chat.id));
  if (!user) {
    await send(msg.chat.id, "This chat is not linked. Open THE ASCENT → Settings → Notifications, enable Telegram and save this chat id: " + msg.chat.id);
    return;
  }
  if (text.startsWith("/test")) {
    const parts = text.split(/\s+/).slice(1).map(Number);
    const c = parts[0] ?? NaN;
    const w = parts[1] ?? NaN;
    const b = parts[2] ?? NaN;
    if (!Number.isInteger(c) || !Number.isInteger(w) || c < 0 || w < 0) {
      await send(msg.chat.id, "Usage: /test <correct> <wrong> [blank] — e.g. /test 8 2 1");
      return;
    }
    try {
      const row = await logTest(db, user.id, { correct: c, wrong: w, blank: Number.isInteger(b) && b >= 0 ? b : 0 }, { tz: user.tz, rolloverHour: user.rolloverHour });
      await send(msg.chat.id, `Logged: ${c}✓ ${w}✗ ${row.blank}○ → net ${netPct(row).toFixed(1)}% (${row.gameDay})`);
    } catch (e) {
      await send(msg.chat.id, `Could not log: ${e instanceof Error ? e.message : "error"}`);
    }
    return;
  }
  if (text.startsWith("/idea")) {
    const idea = text.slice(5).trim();
    if (idea.length < 2) {
      await send(msg.chat.id, "Usage: /idea <one line> — e.g. /idea try interleaving math");
      return;
    }
    await parkIdea(db, user.id, { text: idea.slice(0, 400) });
    await send(msg.chat.id, "Parked in the Idea Vault. Back to the climb.");
    return;
  }
  await send(msg.chat.id, "THE ASCENT quick capture:\n/test 8 2 1 — log a test\n/idea … — park an idea");
}

async function main() {
  console.log("[telegram] bot polling (Ctrl+C to stop)");
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`${api}/getUpdates?timeout=25&offset=${offset}`);
      const data = (await res.json()) as { ok: boolean; result: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
      if (!data.ok) throw new Error("getUpdates failed");
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (u.message) await handle(u.message);
      }
    } catch (e) {
      console.error("[telegram]", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

void main();