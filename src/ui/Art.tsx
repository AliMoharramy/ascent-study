"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";

/**
 * Renders a generated art asset from /public/art, falling back to the inline SVG placeholder
 * until the user drops the real file in (issue #10). A missing/failed asset never blocks a page.
 */
export function Art({
  src,
  alt = "",
  width,
  height,
  className,
  fallback,
}: {
  src: string;
  alt?: string;
  width: number;
  height: number;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      aria-hidden={alt === "" || undefined}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}