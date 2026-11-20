"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./components";
import { Icon } from "./icons";

/** Accessible dialog on top of <dialog>: focus trap & Esc come from the platform. */
export function Modal({ open, onClose, title, children, className, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-label={title} className={cx("m-auto w-[min(92vw,560px)] rounded-card bg-surface-1 p-0 text-ink shadow-card backdrop:bg-black/60", wide && "w-[min(94vw,860px)]", className)}>
      {open && (
        <div className="animate-pop p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="font-display text-title-l uppercase">{title}</h2>
            <button className="btn-ghost px-2.5 py-2" onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
