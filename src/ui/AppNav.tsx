"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./components";

type Item = { href: string; label: string; icon: IconName };

const PRIMARY: Item[] = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/arena", label: "Arena", icon: "sword" },
  { href: "/forge", label: "Forge", icon: "hammer" },
  { href: "/sheets", label: "Sheets", icon: "download" },
];

const SECONDARY: Item[] = [
  { href: "/plan", label: "Plan", icon: "calendar" },
  { href: "/coach", label: "Coach", icon: "chat" },
  { href: "/habits", label: "Habits", icon: "flame" },
  { href: "/life", label: "Life", icon: "sparkle" },
  { href: "/review", label: "Review", icon: "moonStar" },
  { href: "/rest", label: "Rest", icon: "moon" },
  { href: "/final", label: "Final", icon: "flag" },
  { href: "/ideas", label: "Ideas", icon: "bulb" },
  { href: "/character", label: "Me", icon: "user" },
  { href: "/courses", label: "Courses", icon: "book" },
  { href: "/codex", label: "Codex", icon: "layers" },
  { href: "/settings", label: "Settings", icon: "gear" },
];

function NavLink({ it, active, compact }: { it: Item; active: boolean; compact?: boolean }) {
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined} className="group flex flex-col items-center gap-0.5 rounded-2xl px-1.5 py-1 text-caption font-extrabold">
      <span className={cx("grid place-items-center rounded-full transition", compact ? "h-9 w-9" : "h-11 w-11", active ? "bg-purple text-white shadow-[0_6px_18px_rgb(var(--c-purple)/.45)]" : "text-muted group-hover:bg-surface-2 group-hover:text-ink")}>
        <Icon name={it.icon} size={compact ? 18 : 21} />
      </span>
      <span className={active ? "text-purple-ink" : "text-muted"}>{it.label}</span>
    </Link>
  );
}

/** Desktop: vertical rail with every module. Mobile: Today · Map · Arena · Forge · More (sheet). */
export function AppNav() {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const is = (h: string) => path === h || path.startsWith(`${h}/`);
  return (
    <>
      <nav aria-label="Main" className="sticky top-0 hidden h-dvh overflow-y-auto border-e border-line bg-surface-1/95 md:block">
        <ul className="flex flex-col items-center gap-1.5 px-2 py-5">
          {[...PRIMARY, ...SECONDARY].map((it) => (
            <li key={it.href}>
              <NavLink it={it} active={is(it.href)} compact />
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-md justify-around px-2 py-2">
          {PRIMARY.map((it) => (
            <li key={it.href}>
              <NavLink it={it} active={is(it.href)} />
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex flex-col items-center gap-0.5 rounded-2xl px-1.5 py-1 text-caption font-extrabold text-muted">
              <span className={cx("grid h-11 w-11 place-items-center rounded-full", more && "bg-surface-2 text-ink")}>
                <Icon name="more" size={22} />
              </span>
              More
            </button>
          </li>
        </ul>
        {more && (
          <div className="animate-pop border-t border-line px-3 pb-3 pt-2">
            <ul className="grid grid-cols-5 gap-1" onClick={() => setMore(false)}>
              {SECONDARY.map((it) => (
                <li key={it.href}>
                  <NavLink it={it} active={is(it.href)} compact />
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </>
  );
}
