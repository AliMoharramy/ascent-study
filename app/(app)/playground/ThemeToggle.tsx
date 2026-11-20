"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/ui/icons";

/** Preview-only theme switch (does not persist; Settings persists the choice). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<string>("night");
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? "night"), []);
  const flip = () => {
    const t = theme === "night" ? "cream" : "night";
    document.documentElement.dataset.theme = t;
    setTheme(t);
  };
  return (
    <button className="btn-ghost" onClick={flip}>
      <Icon name={theme === "night" ? "sun" : "moon"} size={16} /> {theme === "night" ? "Cream" : "Night"}
    </button>
  );
}
