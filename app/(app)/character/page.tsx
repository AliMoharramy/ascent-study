import { queryOne } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireUser } from "@/server/context";
import { achievementsView, anomalyLog, shopView } from "@/server/shop";
import { xpSummary } from "@/events/projections";
import { hallOfFame } from "@/server/hallOfFame";
import { lootView, monthlyView, streakView } from "@/server/life";
import { addDaysIso, formatJalali } from "@/i18n/jalali";
import { Card, Chip, Eyebrow, LevelBadge, MedalBadge, PageHeader, ProgressBar, StatTile } from "@/ui/components";
import { ShopClient } from "./ShopClient";
import { ExtrasClient } from "./ExtrasClient";
import { avatarView, capsuleView, gemsView, seasonView, skillsView } from "@/server/extras";

export const metadata = { title: "Character" };

/** Character (S11 + S17, #44 #59): level & title, attribute radar, achievements (MedalBadge), Gold & Reward Shop, anti-gaming log. */
export default async function CharacterPage() {
  const { db, userId, today } = await requireUser();
  const xp = (await xpSummary(db, userId, today));
  const ach = (await achievementsView(db, userId, today));
  const since = addDaysIso(today, -6);
  const q = async (s: ReturnType<typeof sql>) => Number((await queryOne<{ v: number | null }>(db, s))?.v ?? 0);
  // attributes (doc 04 §10): balance, not competition — last 7 days, each normalised to a weekly target
  const [mind, body, rest, forge, ideas, bonds] = await Promise.all([
    q(sql`SELECT sum(amount) v FROM xp_ledger WHERE user_id = ${userId} AND game_day >= ${since} AND rule_key NOT LIKE 'xp.pillar%' AND rule_key NOT LIKE 'xp.forge%'`),
    q(sql`SELECT count(*) v FROM habit_logs l JOIN habits h ON h.id = l.habit_id WHERE l.user_id = ${userId} AND l.date >= ${since} AND h.pillar = 'body' AND l.tier_done IS NOT NULL`),
    q(sql`SELECT count(*) v FROM sleep_logs WHERE user_id = ${userId} AND date >= ${since} AND minutes >= 390`),
    q(sql`SELECT count(*) v FROM forge_artifacts WHERE user_id = ${userId} AND created_at >= ${since}`),
    q(sql`SELECT count(*) v FROM ideas WHERE user_id = ${userId} AND created_at >= ${since}`),
    q(sql`SELECT count(*) v FROM habit_logs l JOIN habits h ON h.id = l.habit_id WHERE l.user_id = ${userId} AND l.date >= ${since} AND h.pillar = 'bonds' AND l.tier_done IS NOT NULL`),
  ]);
  const attrs = [
    { k: "Mind", v: mind / 560 },
    { k: "Body", v: body / 4 },
    { k: "Rest", v: rest / 7 },
    { k: "Craft", v: (forge + ideas) / 4 },
    { k: "Bonds", v: bonds / 2 },
  ].map((a) => ({ ...a, v: Math.max(0.04, Math.min(1, a.v)) }));
  const pt = (i: number, r: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / attrs.length;
    return [100 + Math.cos(ang) * r * 80, 100 + Math.sin(ang) * r * 80] as const;
  };
  const unlocked = ach.filter((a) => a.unlockedAt);
  const anomalies = (await anomalyLog(db, userId));
  const fame = (await hallOfFame(db, userId));
  const streak = (await streakView(db, userId, today));
  const monthly = (await monthlyView(db, userId, today));
  const loot = (await lootView(db, userId, today));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="The Ascender" title="Character" />
      <div className="grid gap-4 md:grid-cols-3">
        <Card tone="purple" className="flex flex-col gap-3">
          <LevelBadge level={xp.level} size={72} />
          <p className="font-display text-display-m uppercase leading-none">{xp.title}</p>
          <ProgressBar value={xp.progress} tone="yellow" label="Level progress" />
          <p className="text-body-s font-bold">
            {xp.xpIntoLevel} / {xp.xpForNext} XP to level {xp.level + 1} · {xp.levelXp} level XP total
          </p>
          <p className="text-caption opacity-80">XP never goes down. Non-study XP counts up to 30 % per week; the rest becomes Gold.</p>
        </Card>
        <Card className="flex flex-col items-center gap-2">
          <Eyebrow>Attributes · last 7 days</Eyebrow>
          <svg viewBox="0 0 200 200" className="w-56" role="img" aria-label={attrs.map((a) => `${a.k} ${Math.round(a.v * 100)}%`).join(", ")}>
            {[0.33, 0.66, 1].map((r) => (
              <polygon key={r} points={attrs.map((_, i) => pt(i, r).join(",")).join(" ")} fill="none" stroke="rgb(var(--border))" />
            ))}
            <polygon points={attrs.map((a, i) => pt(i, a.v).join(",")).join(" ")} fill="rgb(var(--c-mint) / 0.45)" stroke="rgb(var(--c-mint))" strokeWidth="2" />
            {attrs.map((a, i) => {
              const [x, y] = pt(i, 1.18);
              return (
                <text key={a.k} x={x} y={y + 4} textAnchor="middle" className="fill-[rgb(var(--text))] text-[11px] font-bold">
                  {a.k}
                </text>
              );
            })}
          </svg>
          <p className="text-caption text-muted">Balance, not competition (doc 04 §10).</p>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Gold" value={Math.round(xp.gold)} tone="yellow" />
          <StatTile label="Season SS" value={Math.round(xp.seasonSs)} />
          <StatTile label="Week SS" value={Math.round(xp.weekSs)} />
          <StatTile label="Achievements" value={`${unlocked.length}/${ach.length}`} />
        </div>
      </div>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Achievements</Eyebrow>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {[...unlocked, ...ach.filter((a) => !a.unlockedAt)].map((a) => (
            <MedalBadge key={a.key} name={a.name} description={a.description} tier={a.tier} unlocked={!!a.unlockedAt} progress={a.progress} />
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Hall of Fame · personal records</Eyebrow>
        <div className="grid gap-2 sm:grid-cols-3">
          <StatTile label="Best XP day" value={fame.bestDayXp?.xp ?? "—"} unit={fame.bestDayXp ? "XP" : undefined} tone="yellow" hint={fame.bestDayXp ? formatJalali(fame.bestDayXp.day) : "Log a study day to open the hall"} />
          <StatTile label="Best test net" value={fame.bestNet?.pct ?? "—"} unit={fame.bestNet ? "%" : undefined} tone="mint" hint={fame.bestNet ? `${formatJalali(fame.bestNet.day)} · ${fame.bestNet.correct} correct, ${fame.bestNet.wrong} wrong` : "No graded test yet"} />
          <StatTile
            label="Longest standard streak"
            value={fame.longestStandard?.days ?? "—"}
            unit={fame.longestStandard ? "days" : undefined}
            tone="purple"
            hint={fame.longestStandard ? `${formatJalali(fame.longestStandard.from)} → ${formatJalali(fame.longestStandard.to)} · ${fame.standardDays} standard days total` : "A standard day needs a completed Core"}
          />
        </div>
        <p className="text-caption text-muted">Records are yours alone — no leaderboard, no rivals. A record only moves when you beat it.</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Eyebrow>Streak Society · medals never reset</Eyebrow>
            <p className="mt-1 text-body-s font-bold">Longest Standard run {streak.maxStreak} days · 30-day consistency {Math.round(streak.consistency30 * 100)} %</p>
          </div>
          <Chip tone={streak.medals.some((m) => m.reached) ? "lime" : "surface"}>{streak.medals.filter((m) => m.reached).length}/4 medals</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {streak.medals.map((m, i) => (
            <MedalBadge
              key={m.days}
              name={`${m.days}-day streak`}
              description={m.reached ? m.story : `Reach ${m.days} Standard days with ≥ 80 % consistency. ${m.days - streak.maxStreak > 0 ? `${m.days - streak.maxStreak} to go.` : "Consistency is the only thing missing."}`}
              tier={i < 2 ? "bronze" : i === 2 ? "silver" : "gold"}
              unlocked={m.reached}
              progress={[Math.round(m.progress * m.days), m.days]}
            />
          ))}
        </div>
        <p className="text-caption text-muted">A medal needs both the run and ≥ 80 % consistency across the last 30 days. It is a record of your best rhythm, not today&apos;s mood.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <Eyebrow>Monthly badges</Eyebrow>
          {monthly.badges.length === 0 ? (
            <p className="text-body-s text-muted">No monthly badge yet. Finish the {monthly.theme.name.toLowerCase()} challenge to earn the limited badge for {monthly.month}.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {monthly.badges.map((b) => (
                <li key={b.monthKey}>
                  <Chip tone="purple">
                    {b.monthKey} · {b.badge}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-muted">Limited to the month it was earned — the challenge rotates, the shelf does not.</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>Loot vault · pity {loot.pity}/7</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="yellow">Codex {loot.counts.codex ?? 0}</Chip>
            <Chip tone="mint">Cosmetic {loot.counts.cosmetic ?? 0}</Chip>
            <Chip tone="purple">Shield {loot.counts.shield ?? 0}</Chip>
            <Chip tone="surface">Empty {loot.counts.none ?? 0}</Chip>
          </div>
          {loot.rolls.length === 0 ? (
            <p className="text-body-s text-muted">The vault is empty. A chest is rolled at each Standard day close.</p>
          ) : (
            <p className="text-body-s">
              Last roll: <b>{loot.rolls[0]!.date}</b> · {loot.rolls[0]!.result} · {loot.rolls.length} rolls kept in the log.
            </p>
          )}
          {loot.claims.length > 0 && <p className="text-caption text-muted">Quest Board claims: {loot.claims.reduce((s, c) => s + c.gold, 0)} Gold across the last {loot.claims.length} boards.</p>}
        </Card>
      </div>
      <ShopClient shop={(await shopView(db, userId, today))} />
      <ExtrasClient data={{ gems: (await gemsView(db, userId)), skills: (await skillsView(db, userId)), avatar: (await avatarView(db, userId)), season: (await seasonView(db, userId, today)), capsule: (await capsuleView(db, userId, today)) }} />
      <Card className="flex flex-col gap-2">
        <Eyebrow>Anti-gaming log · warnings only (Honesty Pact)</Eyebrow>
        {anomalies.length === 0 ? (
          <p className="text-body-s text-muted">Nothing unusual. The game is against yourself — the data is yours.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-body-s">
            {anomalies.map((a, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-1.5">
                <b>{a.day}</b> · {a.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
