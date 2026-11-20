"use client";

import { useState } from "react";
import { EXAM_DATE_JALALI } from "@/lib/campaign";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, ProgressBar, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import type { avatarView, capsuleView, gemsView, seasonView, skillsView } from "@/server/extras";

type Data = { gems: Awaited<ReturnType<typeof gemsView>>; skills: Awaited<ReturnType<typeof skillsView>>; avatar: Awaited<ReturnType<typeof avatarView>>; season: Awaited<ReturnType<typeof seasonView>>; capsule: Awaited<ReturnType<typeof capsuleView>> };

const COLOR_HEX: Record<string, string> = { amber: "#F2C24E", mint: "#8FD9D0", coral: "#E8553F", violet: "#7C6CF2", sky: "#5BB8E8", rose: "#E87BA4" };

/** Gems, skill tree, avatar, free Season Pass and the time capsule (#87, #90, #91). */
export function ExtrasClient({ data }: { data: Data }) {
  const { toast, celebrate } = useFeedback();
  const [letter, setLetter] = useState("");
  const [avatar, setAvatar] = useState(data.avatar.avatar);
  async function post(body: Record<string, unknown>, ok: string, party = false) {
    try {
      await apiFetch("/api/extras", { body });
      if (party) celebrate(ok);
      else toast(ok);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  const a = data.avatar;
  return (
    <div className="flex flex-col gap-4">
      <Card tone="purple" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Gems · earned by real wins</Eyebrow>
          <Chip tone="purple" icon="sparkle">{data.gems.balance} Gems</Chip>
        </div>
        <p className="text-caption opacity-80">Chapter clears, boss wins, duels, perfect runs and streak milestones pay Gems. Nothing here costs money — ever.</p>
        {data.gems.recent.length > 0 && (
          <ul className="flex flex-col gap-1 text-caption">
            {data.gems.recent.slice(0, 6).map((g) => (
              <li key={g.id} className="flex justify-between rounded-xl bg-surface-1/60 px-3 py-1">
                <span>{g.note || g.ruleKey}</span>
                <b className={g.amount >= 0 ? "text-mint-ink" : "text-coral-ink"}>{g.amount >= 0 ? "+" : ""}{g.amount}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Skill tree · small real perks</Eyebrow>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.skills.skills.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-3xl bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-extrabold">{s.name}</p>
                <Chip tone={s.tier === 3 ? "lime" : "surface"}>{s.tier}/3</Chip>
              </div>
              <p className="text-caption text-muted">{s.perk}</p>
              <div className="flex gap-1.5">
                {s.tiers.map((t, i) => (
                  <span key={t} className={cx("flex-1 rounded-xl px-2 py-1 text-center text-caption font-bold", i < s.tier ? "bg-purple text-white" : "bg-surface-1 text-muted")}>{t}</span>
                ))}
              </div>
              {s.nextCost !== null ? (
                <button className="btn-accent self-start py-1.5" disabled={data.gems.balance < s.nextCost} onClick={() => post({ action: "unlock", skillId: s.id }, `${s.name} tier ${s.tier + 1} unlocked`, true)}>
                  <Icon name="sparkle" size={14} /> Unlock · {s.nextCost} Gems
                </button>
              ) : (
                <p className="text-caption font-bold text-mint-ink">Maxed — the perk is live in every engine.</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Avatar · dress the Ascender</Eyebrow>
        <div className="flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 120 120" className="h-28 w-28" role="img" aria-label="Avatar preview">
            <circle cx="60" cy="60" r="54" fill={COLOR_HEX[avatar.color] ?? "#F2C24E"} opacity="0.25" />
            <circle cx="60" cy="46" r="22" fill={COLOR_HEX[avatar.color] ?? "#F2C24E"} />
            <path d="M28 104c4-26 18-36 32-36s28 10 32 36z" fill={COLOR_HEX[avatar.color] ?? "#F2C24E"} />
            {avatar.outfit === "cloak" && <path d="M24 104c2-30 16-42 36-42s34 12 36 42l-10 0c-2-22-12-30-26-30s-24 8-26 30z" fill="#3A3A44" />}
            {avatar.outfit === "armor" && <rect x="42" y="66" width="36" height="30" rx="8" fill="#8A8A96" />}
            {avatar.outfit === "hoodie" && <path d="M38 70c6-10 14-14 22-14s16 4 22 14l-6 6c-4-8-10-10-16-10s-12 2-16 10z" fill="#4A4A55" />}
            {avatar.outfit === "scarf" && <rect x="40" y="62" width="40" height="10" rx="5" fill="#E8553F" />}
            {avatar.tool === "staff" && <rect x="88" y="30" width="5" height="70" rx="2.5" fill="#8A5A2B" />}
            {avatar.tool === "lantern" && <circle cx="92" cy="70" r="9" fill="#F2C24E" stroke="#8A5A2B" strokeWidth="2" />}
            {avatar.tool === "book" && <rect x="84" y="66" width="16" height="20" rx="3" fill="#7C6CF2" />}
            {avatar.tool === "compass" && <circle cx="92" cy="76" r="9" fill="#8FD9D0" stroke="#3A3A44" strokeWidth="2" />}
          </svg>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {a.colors.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setAvatar({ ...avatar, color: c })} className={cx("h-8 w-8 rounded-full border-2", avatar.color === c ? "border-ink" : "border-transparent")} style={{ background: COLOR_HEX[c] }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={avatar.outfit === null ? "purple" : "surface"} className="cursor-pointer" >
                <button type="button" onClick={() => setAvatar({ ...avatar, outfit: null })}>No outfit</button>
              </Chip>
              {a.outfits.map((o) => (
                <Chip key={o.id} tone={avatar.outfit === o.id ? "purple" : "surface"}>
                  <button type="button" onClick={() => setAvatar({ ...avatar, outfit: o.id })}>{o.name}{a.avatar.owned.includes(o.id) ? "" : ` · ${o.cost}G`}</button>
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={avatar.tool === null ? "purple" : "surface"}>
                <button type="button" onClick={() => setAvatar({ ...avatar, tool: null })}>No tool</button>
              </Chip>
              {a.tools.map((t) => (
                <Chip key={t.id} tone={avatar.tool === t.id ? "purple" : "surface"}>
                  <button type="button" onClick={() => setAvatar({ ...avatar, tool: t.id })}>{t.name}{a.avatar.owned.includes(t.id) ? "" : ` · ${t.cost}G`}</button>
                </Chip>
              ))}
            </div>
            <button className="btn-accent self-start py-1.5" onClick={() => post({ action: "avatar", avatar: { color: avatar.color, outfit: avatar.outfit, tool: avatar.tool } }, "Avatar saved")}>
              <Icon name="user" size={14} /> Save look
            </button>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Season Pass · free 25-week track</Eyebrow>
          <Chip tone="lime">Week {data.season.week}/25</Chip>
        </div>
        {!data.season.enabled && <p className="text-body-s text-muted">Season Pass is off in Settings → Feature flags.</p>}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {data.season.stops.map((s) => (
            <div key={s.week} className={cx("flex w-32 shrink-0 flex-col gap-1.5 rounded-3xl p-3", s.claimed ? "bg-mint/30" : s.claimable ? "bg-yellow/30" : "bg-surface-2")}>
              <p className="text-caption font-extrabold">W{s.week} · {s.title}</p>
              <p className="text-caption text-muted">{s.gold} Gold · {s.gems} Gems</p>
              <ProgressBar value={Math.min(1, s.standardDays / s.needStandardDays)} tone={s.claimed ? "mint" : "yellow"} label={`${s.standardDays}/${s.needStandardDays} Standard days`} />
              {s.claimed ? (
                <Chip tone="mint">Claimed</Chip>
              ) : s.claimable ? (
                <button className="btn-accent py-1 text-caption" onClick={() => post({ action: "season_claim", week: s.week }, `Week ${s.week} chest claimed`, true)}>Claim</button>
              ) : (
                <p className="text-caption text-muted">{s.locked ? "Week still running" : `Needs ${s.needStandardDays} Standard days`}</p>
              )}
            </div>
          ))}
        </div>
        <p className="text-caption text-muted">Claim opens after the week ends. No purchase, no premium tier — the whole track is free (N4).</p>
      </Card>

      <Card tone="yellow" className="flex flex-col gap-3">
        <Eyebrow>Time capsule · a letter to exam-day you</Eyebrow>
        {!data.capsule.sealed ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post({ action: "capsule_seal", text: letter }, "Capsule sealed — it opens on exam day", true);
              setLetter("");
            }}
          >
            <textarea className="input min-h-28" value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={4000} placeholder={`Write to the person who walks out of the exam hall… (encrypted, opens ${EXAM_DATE_JALALI})`} />
            <button className="btn-accent self-start py-1.5" disabled={letter.trim().length < 10}>
              <Icon name="moonStar" size={14} /> Seal until exam day
            </button>
            <p className="text-caption opacity-80">AES-256-GCM encrypted. {data.capsule.keySource === "local" ? "Set CAPSULE_KEY in the server env for full key separation." : "Key held in server env, separate from backups."}</p>
          </form>
        ) : data.capsule.open ? (
          <div className="flex flex-col gap-2">
            <Chip tone="lime">Opened · exam day is here</Chip>
            <p className="whitespace-pre-wrap rounded-3xl bg-surface-1 p-4 text-body-s font-bold">{data.capsule.text}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <StatTile label="Opens on" value={data.capsule.opensOn} tone="purple" hint={`${data.capsule.daysLeft} days left`} />
            <p className="text-caption opacity-80">The letter stays encrypted until exam morning. It will also appear at the Summit on the map.</p>
            {data.capsule.error && <p className="text-caption font-bold text-coral-ink">{data.capsule.error}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
