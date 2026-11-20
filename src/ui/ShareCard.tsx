"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Modal } from "@/ui/Modal";
import { formatJalali } from "@/i18n/jalali";
import type { bossShareView } from "@/server/arena";

type ShareData = Awaited<ReturnType<typeof bossShareView>>;

const KIND_LABEL: Record<string, string> = { weekly: "WEEKLY BOSS", region: "REGION BOSS", mini_trial: "MINI-TRIAL" };

/** Draws the 1200×630 card. Default: net %, verdict, week, Jalali date only — breakdown is opt-in (#114). */
function draw(canvas: HTMLCanvasElement, d: ShareData, breakdown: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = 1200;
  const H = 630;
  ctx.fillStyle = "#0E0E10";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#6E5CE8";
  ctx.fillRect(0, 0, W, 12);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#9A9AA3";
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.fillText("THE ASCENT · 25-WEEK CAMPAIGN", 60, 84);
  ctx.fillStyle = "#F5F2EA";
  ctx.font = "800 46px system-ui, sans-serif";
  ctx.fillText(`${KIND_LABEL[d.kind] ?? "BOSS"} · WEEK ${d.weekNo}`, 60, 148);
  ctx.fillStyle = "#F2C24E";
  ctx.font = "900 190px system-ui, sans-serif";
  ctx.fillText(`${d.netPct}%`, 56, 372);
  ctx.fillStyle = "#9A9AA3";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.fillText("net score (wrong = −⅓)", 60, 416);
  const verdict = d.defeated ? "DEFEATED" : d.defeated === false ? "SURVIVED" : "LOGGED";
  const vColor = d.defeated ? "#9BD24E" : d.defeated === false ? "#E8553F" : "#8FD9D0";
  ctx.fillStyle = vColor;
  ctx.beginPath();
  ctx.roundRect(60, 448, 320, 66, 33);
  ctx.fill();
  ctx.fillStyle = "#111114";
  ctx.font = "800 34px system-ui, sans-serif";
  ctx.fillText(verdict, 92, 492);
  ctx.fillStyle = "#9A9AA3";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText(`${formatJalali(d.date)} · ${d.date}`, 60, 576);

  if (breakdown && d.perChapter.length > 0) {
    ctx.fillStyle = "#F5F2EA";
    ctx.font = "800 26px system-ui, sans-serif";
    ctx.fillText("CHAPTER BREAKDOWN", 640, 96);
    ctx.font = "600 25px system-ui, sans-serif";
    d.perChapter.slice(0, 9).forEach((c, i) => {
      const y = 150 + i * 50;
      ctx.fillStyle = "#9A9AA3";
      const label = `${c.subject ? `${c.subject} · ` : ""}${c.title}`;
      ctx.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, 640, y);
      ctx.fillStyle = c.netPct >= 50 ? "#9BD24E" : c.netPct >= 25 ? "#F2C24E" : "#E8553F";
      ctx.textAlign = "right";
      ctx.fillText(`${c.netPct}%`, 1140, y);
      ctx.textAlign = "left";
    });
    if (d.perChapter.length > 9) {
      ctx.fillStyle = "#9A9AA3";
      ctx.fillText(`+${d.perChapter.length - 9} more`, 640, 150 + 9 * 50);
    }
  } else {
    // simple summit mark — no personal data, no art assets needed
    ctx.strokeStyle = "#6E5CE8";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(700, 480);
    ctx.lineTo(880, 200);
    ctx.lineTo(990, 360);
    ctx.lineTo(1060, 280);
    ctx.lineTo(1160, 480);
    ctx.stroke();
    ctx.fillStyle = "#F2C24E";
    ctx.beginPath();
    ctx.arc(880, 160, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Boss result share dialog (#114, F-SOC-05): generated on-device, nothing uploaded, breakdown strictly opt-in. */
export function BossShareDialog({ bossId, onClose }: { bossId: string | null; onClose: () => void }) {
  const [data, setData] = useState<ShareData | null>(null);
  const [breakdown, setBreakdown] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bossId) {
      setData(null);
      setBreakdown(false);
      return;
    }
    let live = true;
    apiFetch<ShareData>(`/api/arena?share=${encodeURIComponent(bossId)}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => onClose());
    return () => {
      live = false;
    };
  }, [bossId, onClose]);

  useEffect(() => {
    if (data && canvasRef.current) draw(canvasRef.current, data, breakdown);
  }, [data, breakdown]);

  function png(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const c = canvasRef.current;
      if (!c) return resolve(null);
      c.toBlob((b) => resolve(b), "image/png");
    });
  }

  async function download() {
    const blob = await png();
    if (!blob || !data) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ascent-boss-week${data.weekNo}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function share() {
    const blob = await png();
    if (!blob || !data) return;
    const file = new File([blob], `ascent-boss-week${data.weekNo}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "THE ASCENT — boss result" }).catch(() => null);
    } else {
      await download();
    }
  }

  return (
    <Modal open={!!bossId} onClose={onClose} title="Share result card" wide>
      {data && (
        <div className="flex flex-col gap-3">
          <canvas ref={canvasRef} width={1200} height={630} className="w-full rounded-2xl border border-line" role="img" aria-label={`Boss result card: ${data.netPct}% net, ${data.defeated ? "defeated" : data.defeated === false ? "survived" : "logged"}, week ${data.weekNo}`} />
          <label className="flex items-center gap-2 text-body-s font-bold">
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-purple))]" checked={breakdown} onChange={(e) => setBreakdown(e.target.checked)} />
            Include chapter breakdown (off by default)
          </label>
          <p className="text-caption text-muted">
            Privacy: the default card shows only net %, verdict, week and date — no name, no rank, no question content. The image is drawn on your device; nothing is uploaded.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={download}>Download PNG</button>
            <button className="btn-accent" onClick={share}>Share…</button>
          </div>
        </div>
      )}
    </Modal>
  );
}