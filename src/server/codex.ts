import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { decisions } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { normalizeFa, renderMarkdown } from "@/lib/markdown";

/** Codex (T-R2-11 / F-CDX-01/02): read the design docs, ADRs and research with Persian full-text search + Decision Log. */

export function docsDir() {
  return process.env.DOCS_DIR ?? path.join(process.cwd(), "docs");
}

export interface DocMeta {
  id: string; // relative path, e.g. "04-game-design.md" or "research/T-DATA-01-exam-date.md"
  title: string;
  group: "design" | "research" | "ops" | "archive";
  bytes: number;
}

function walk(dir: string, rel = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : e.name.endsWith(".md") ? [`${rel}${e.name}`] : []));
}

export function listDocs(): DocMeta[] {
  const root = docsDir();
  return walk(root)
    .sort()
    .map((id) => {
      const text = fs.readFileSync(path.join(root, id), "utf8");
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? id;
      const group: DocMeta["group"] = id.startsWith("research/") ? "research" : id.startsWith("archive/") ? "archive" : /^\d{2}-/.test(id) || id === "README.md" || id === "adr.md" ? "design" : "ops";
      return { id, title, group, bytes: text.length };
    });
}

/** Resolves a doc id safely (no path traversal). */
export function readDoc(id: string) {
  const root = path.resolve(docsDir());
  const full = path.resolve(root, id);
  if (!full.startsWith(root + path.sep) || !full.endsWith(".md") || !fs.existsSync(full)) return null;
  const md = fs.readFileSync(full, "utf8");
  return { id, md, ...renderMarkdown(md) };
}

export interface SearchHit {
  id: string;
  title: string;
  line: number;
  snippet: string;
}

export function searchDocs(q: string, limit = 60): SearchHit[] {
  const nq = normalizeFa(q.trim());
  if (nq.length < 2) return [];
  const terms = nq.split(" ").filter(Boolean);
  const hits: SearchHit[] = [];
  for (const d of listDocs()) {
    const lines = fs.readFileSync(path.join(docsDir(), d.id), "utf8").split("\n");
    lines.forEach((l, i) => {
      const nl = normalizeFa(l);
      if (terms.every((t) => nl.includes(t))) hits.push({ id: d.id, title: d.title, line: i + 1, snippet: l.trim().slice(0, 220) });
    });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

export const decisionInput = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().max(4000).default(""),
  rationale: z.string().trim().min(5, "Every decision needs a reason").max(2000),
  alternatives: z.string().trim().max(2000).default(""),
  status: z.enum(["proposed", "accepted", "superseded", "rejected"]).default("accepted"),
});

export async function recordDecision(db: Db, userId: string, input: z.input<typeof decisionInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = decisionInput.parse(input);
  const id = newId();
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(decisions).values({ id, userId, date: today, ...d, createdAt: now, updatedAt: now }));
    (await appendEvent(tx, { userId, type: "decision.recorded", payload: { decisionId: id, title: d.title, status: d.status } }));
  }));
  return id;
});
}

export async function setDecisionStatus(db: Db, userId: string, id: string, status: "proposed" | "accepted" | "superseded" | "rejected") {
  return await withUserTransaction(db, userId, async (tx) => {
  (await tx.update(decisions).set({ status, updatedAt: nowIso() }).where(and(eq(decisions.id, id), eq(decisions.userId, userId))));
});
}

export async function listDecisions(db: Db, userId: string, q?: string) {
  const rows = (await db.select().from(decisions).where(eq(decisions.userId, userId)).orderBy(desc(decisions.date), desc(decisions.createdAt)));
  if (!q) return rows;
  const nq = normalizeFa(q);
  return rows.filter((r) => normalizeFa(`${r.title} ${r.body} ${r.rationale} ${r.alternatives}`).includes(nq));
}
