/**
 * Export builders (#103, F-INT-02/03): RFC 5545 ICS calendar and Anki text-import TSV. Pure string builders —
 * the server gathers the rows. Anki export carries review cards (takeaways / artifacts), NEVER test-bank questions.
 */

// ── ICS ──────────────────────────────────────────────────────

export interface IcsEvent {
  uid: string;
  date: string; // ISO game day
  startMin: number | null; // minutes from midnight; null = all-day event
  endMin: number | null;
  summary: string;
  description?: string;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const pad = (n: number) => String(n).padStart(2, "0");
const dateCompact = (iso: string) => iso.replace(/-/g, "");
const hm = (m: number) => `${pad(Math.floor(m / 60) % 24)}${pad(m % 60)}00`;

/** RFC 5545 line folding: max 75 octets per line, continuation lines start with a space. UTF-8 aware. */
export function foldLine(line: string): string[] {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(line) <= 75) return [line];
  const out: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of line) {
    if (bytes(cur + ch) > limit) {
      out.push(cur);
      cur = " " + ch;
      limit = 75;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const TEHRAN_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Tehran",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0330",
  "TZOFFSETTO:+0330",
  "TZNAME:+0330",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(events: IcsEvent[], opts: { nowIso: string; tzid?: string; prodId?: string }): string {
  const stamp = opts.nowIso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z$/, "") + "Z";
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${opts.prodId ?? "-//The Ascent//Plan//EN"}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:The Ascent — study plan"];
  if (opts.tzid === "Asia/Tehran") lines.push(...TEHRAN_TZ);
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.startMin === null || e.endMin === null) {
      const next = new Date(`${e.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${dateCompact(e.date)}`, `DTEND;VALUE=DATE:${dateCompact(next.toISOString().slice(0, 10))}`);
    } else {
      const tz = opts.tzid ? `;TZID=${opts.tzid}` : "";
      lines.push(`DTSTART${tz}:${dateCompact(e.date)}T${hm(e.startMin)}`, `DTEND${tz}:${dateCompact(e.date)}T${hm(e.endMin)}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

// ── Anki ─────────────────────────────────────────────────────

export interface AnkiCard {
  front: string;
  back: string;
  tags: string[];
}

const ankiField = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "<br>").trim();
const ankiTag = (s: string) => s.replace(/[^\p{L}\p{N}_-]/gu, "_").replace(/^_+|_+$/g, "");

/** Anki ≥ 2.1.55 text import: tab-separated, HTML on, explicit deck + tags column. */
export function buildAnki(cards: AnkiCard[], deck: string): string {
  const header = ["#separator:tab", "#html:true", `#deck:${ankiField(deck)}`, "#tags column:3"];
  const rows = cards.map((c) => [ankiField(c.front), ankiField(c.back), c.tags.map(ankiTag).filter(Boolean).join(" ")].join("\t"));
  return [...header, ...rows].join("\n") + "\n";
}