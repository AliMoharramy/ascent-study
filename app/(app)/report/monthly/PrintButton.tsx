"use client";

import { Icon } from "@/ui/icons";

export function PrintButton() {
  return (
    <button className="btn-primary" onClick={() => window.print()}>
      <Icon name="download" size={16} /> Print / save PDF
    </button>
  );
}