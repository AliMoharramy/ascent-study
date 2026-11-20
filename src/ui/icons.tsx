import type { SVGProps } from "react";

/**
 * Sticker-duotone icon set (24px grid) — thick rounded outline + a soft color-block fill,
 * echoing the project's flat-vector / thick-outline / color-block art (docs/art-brief.md).
 * Monochrome via currentColor (outline full, fill at 0.2) → AA on both Night & Cream.
 * Pure-line utility glyphs stay stroke-only; play/pause/stop/bolt stay solid. No icon font/CDN.
 */
type IconSpec = { fill?: string; stroke: string };

const paths = {
  arrow: { stroke: "M5 12h14M13 6l6 6-6 6" },
  play: { stroke: "M8 5.5v13l11-6.5z" },
  pause: { stroke: "M8 5h3v14H8zM13 5h3v14h-3z" },
  stop: { stroke: "M6 6h12v12H6z" },
  check: { stroke: "M5 12.5l4.5 4.5L19 7.5" },
  x: { stroke: "M6 6l12 12M18 6L6 18" },
  flame: {
    fill: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.5-4.6.2 1.7 1 2.6 2 2.6 0-3 .5-5.5 .5-8z",
    stroke: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.5-4.6.2 1.7 1 2.6 2 2.6 0-3 .5-5.5 .5-8z",
  },
  bolt: { stroke: "M13 2L4 14h7l-1 8 9-12h-7z" },
  book: {
    fill: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z",
    stroke: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20",
  },
  today: {
    fill: "M5 5h14v15H5z",
    stroke: "M4 7h16M8 3v4M16 3v4M5 5h14v15H5zM9 13l2 2 4-4",
  },
  list: { stroke: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" },
  gear: {
    fill: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    stroke:
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  },
  palette: {
    fill: "M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z",
    stroke: "M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8zM7.5 12h.01M9.5 8h.01M14.5 8h.01",
  },
  logout: { stroke: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" },
  upload: { stroke: "M12 16V4M7 9l5-5 5 5M4 20h16" },
  download: { stroke: "M12 4v12M7 11l5 5 5-5M4 20h16" },
  moon: {
    fill: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    stroke: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  },
  sun: {
    fill: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    stroke: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  },
  target: {
    fill: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    stroke: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  },
  moonStar: {
    fill: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    stroke: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5zM17 3v4M15 5h4",
  },
  sparkle: {
    fill: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    stroke: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  },
  trash: {
    fill: "M6 7l1 13h10l1-13z",
    stroke: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  },
  plus: { stroke: "M12 5v14M5 12h14" },
  undo: { stroke: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" },
  clock: {
    fill: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    stroke: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  },
  map: {
    fill: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z",
    stroke: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  },
  sword: {
    fill: "M14.5 3H21v6.5L10 20.5 3.5 14z",
    stroke: "M14.5 3H21v6.5L10 20.5 3.5 14zM5 19l-2 2M8 16l-3 3",
  },
  hammer: {
    fill: "M14 4l6 6-3 3-6-6z",
    stroke: "M14 4l6 6-3 3-6-6zM11 7l-8 8 3 3 8-8",
  },
  flag: {
    fill: "M5 4h11l-2 4 2 4H5z",
    stroke: "M5 21V4M5 4h11l-2 4 2 4H5",
  },
  chat: {
    fill: "M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z",
    stroke: "M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12zM8.5 12h.01M12 12h.01M15.5 12h.01",
  },
  flask: {
    fill: "M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3z",
    stroke: "M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3M7.5 15h9",
  },
  heart: {
    fill: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
    stroke: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  },
  bulb: {
    fill: "M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
    stroke: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  },
  layers: {
    fill: "M12 3l9 5-9 5-9-5z",
    stroke: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  },
  shield: {
    fill: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    stroke: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  },
  star: {
    fill: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
    stroke: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  },
  user: {
    fill: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0z",
    stroke: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  },
  users: {
    fill: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0z",
    stroke: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3",
  },
  skull: {
    fill: "M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z",
    stroke: "M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3zM9 12h.01M15 12h.01M10 20v-2M14 20v-2",
  },
  calendar: {
    fill: "M4 6h16v15H4z",
    stroke: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  },
  keyboard: {
    fill: "M3 6h18v12H3z",
    stroke: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  },
  expand: { stroke: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" },
  search: {
    fill: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z",
    stroke: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  },
  more: { stroke: "M5 12h.01M12 12h.01M19 12h.01" },
  gift: {
    fill: "M4 10h16v11H4zM2 7h20v3H2z",
    stroke: "M4 10h16v11H4zM2 7h20v3H2zM12 7v14M12 7S10 3 7.5 3 5 5.5 7 7M12 7s2-4 4.5-4S19 5.5 17 7",
  },
  lock: {
    fill: "M5 11h14v10H5z",
    stroke: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v3",
  },
  mail: {
    fill: "M3 6h18v12H3z",
    stroke: "M3 6h18v12H3zM3 7l9 6 9-6",
  },
  bell: {
    fill: "M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16z",
    stroke: "M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16zM10 21a2 2 0 0 0 4 0",
  },
  offline: { stroke: "M2 2l20 20M5 12a10 10 0 0 1 5.2-2.7M12 5c3.5 0 6.7 1.4 9 3.7M8.5 15.5a5 5 0 0 1 5-1.3M12 19h.01" },
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof paths;

const SOLID = new Set<string>(["play", "pause", "stop", "bolt"]);
const FILL_OPACITY = 0.2;
const STROKE_WIDTH = 2.4;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const spec: IconSpec = paths[name];
  const { fill, stroke } = spec;
  const solid = SOLID.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {fill && !solid ? <path d={fill} fill="currentColor" fillOpacity={FILL_OPACITY} stroke="none" /> : null}
      <path d={stroke} fill={solid ? "currentColor" : "none"} stroke={solid ? "none" : undefined} />
    </svg>
  );
}