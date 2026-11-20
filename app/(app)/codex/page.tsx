import Link from "next/link";
import { requireUser } from "@/server/context";
import { listDecisions, listDocs, readDoc, searchDocs } from "@/server/codex";
import { Card, cx, Eyebrow, PageHeader } from "@/ui/components";
import { DecisionLog } from "./DecisionLog";

export const metadata = { title: "Codex" };

/** Codex (S19, #60): design docs, ADRs and research with Persian full-text search; Decision Log. */
export default async function CodexPage({ searchParams }: { searchParams: Promise<{ doc?: string; q?: string }> }) {
  const { doc, q } = await searchParams;
  const { db, userId } = await requireUser();
  const docs = listDocs();
  const current = readDoc(doc ?? "README.md");
  const hits = q ? searchDocs(q) : [];
  const groups = ["design", "research", "ops", "archive"] as const;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="The Archivist" title="Codex">
        <form className="flex gap-2" action="/codex">
          <input name="q" defaultValue={q} className="field w-64 py-1.5" dir="auto" placeholder="جستجو / search…" aria-label="Search the Codex" />
          <button className="btn-accent py-1.5">Search</button>
        </form>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="card flex max-h-[78vh] flex-col gap-3 overflow-y-auto" aria-label="Documents">
          {groups.map((g) => {
            const list = docs.filter((d) => d.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <Eyebrow>{g}</Eyebrow>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {list.map((d) => (
                    <li key={d.id}>
                      <Link href={`/codex?doc=${encodeURIComponent(d.id)}`} className={cx("block truncate rounded-lg px-2 py-1 text-body-s", d.id === current?.id ? "bg-purple font-bold text-white" : "hover:bg-surface-2")} dir="auto" title={d.title}>
                        {d.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <Link href="/codex?doc=adr.md" className="btn-ghost justify-start">
            ADR (architecture decisions)
          </Link>
        </nav>
        <div className="flex flex-col gap-4">
          {q && (
            <Card className="flex flex-col gap-2">
              <Eyebrow>
                {hits.length} result(s) for “{q}”
              </Eyebrow>
              <ul className="flex flex-col gap-1">
                {hits.map((h, i) => (
                  <li key={i}>
                    <Link href={`/codex?doc=${encodeURIComponent(h.id)}&q=${encodeURIComponent(q)}`} className="block rounded-xl bg-surface-2 px-3 py-2 text-body-s hover:ring-2 hover:ring-purple">
                      <span className="text-caption font-extrabold text-muted">
                        {h.title} · line {h.line}
                      </span>
                      <span className="block" dir="auto">
                        {h.snippet}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {current ? (
            <article className="card md max-w-none" dir="auto" lang="fa" dangerouslySetInnerHTML={{ __html: current.html }} />
          ) : (
            <Card>Document not found.</Card>
          )}
          <DecisionLog decisions={(await listDecisions(db, userId, q))} />
        </div>
      </div>
    </div>
  );
}
