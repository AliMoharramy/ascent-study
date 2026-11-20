"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/ui/client";
import { Icon } from "@/ui/icons";

export function NewCourseButton({ subjects }: { subjects: { id: string; nameEn: string }[] }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    try {
      const r = await apiFetch<{ id: string }>("/api/courses", { body: { ...f, speed: Number(f.speed) } });
      router.push(`/courses/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  if (!open)
    return (
      <button className="btn-accent" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> New course
      </button>
    );
  return (
    <form onSubmit={submit} className="card fixed inset-x-4 top-20 z-40 mx-auto grid max-w-lg gap-3 md:absolute md:inset-x-auto md:right-8">
      <h3 className="font-display text-title-l uppercase">New course</h3>
      <select name="subjectId" className="field" required>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nameEn}
          </option>
        ))}
      </select>
      <select name="kind" className="field">
        <option value="teaching">Teaching</option>
        <option value="tips_tests">Tips &amp; tests</option>
      </select>
      <input name="title" className="field" dir="auto" placeholder="Title" required />
      <input name="instructor" className="field" dir="auto" placeholder="Instructor" />
      <input name="platform" className="field" placeholder="Platform" />
      <label className="text-body-s">
        Playback speed <input name="speed" type="number" step="0.25" min="0.5" max="3" defaultValue="1.5" className="field mt-1" />
      </label>
      {err && <p className="text-body-s text-coral-ink">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-accent">Create</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
