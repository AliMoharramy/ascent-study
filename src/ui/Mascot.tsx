import { Art } from "./Art";
import { cx } from "./components";
import { Icon, type IconName } from "./icons";

/**
 * Mascot system (F-DUO-14, doc 12 §3): Hero / Shade / Archie with speech-less states.
 * States are derived from real events on each page (core tier, rival gap, reviews) — never random.
 * `enabled=false` is the calm mode (Settings → Mascots): illustrations disappear, layout stays.
 */

export type MascotCharacter = "hero" | "shade" | "archie";
export type HeroMascotState = "idle" | "happy" | "thinking" | "celebrate" | "tired";
export type ShadeMascotState = "smug" | "winner" | "defeated";
export type ArchieMascotState = "reading" | "thinking" | "cheering" | "warning" | "reviewing";
export type MascotState = HeroMascotState | ShadeMascotState | ArchieMascotState;

const FALLBACK_ICON: Record<MascotCharacter, IconName> = { hero: "user", shade: "moonStar", archie: "book" };

const SIZES = { xs: 64, sm: 96, md: 128, lg: 176, xl: 224 } as const;
export type MascotSize = keyof typeof SIZES;

export function MascotSlot({
  character,
  state,
  size = "md",
  enabled = true,
  message,
  className,
}: {
  character: MascotCharacter;
  state: MascotState;
  size?: MascotSize;
  enabled?: boolean;
  message?: string;
  className?: string;
}) {
  if (!enabled) return null;
  const px = SIZES[size];
  return (
    <figure data-mascot className={cx("flex flex-col items-center gap-2", className)}>
      <div className="rounded-[32%] bg-[#F5F2EA] p-1.5 shadow-card" style={{ width: px }}>
        <Art
          src={`/art/${character}/${character}-${state}.webp`}
          alt={`${character === "archie" ? "Archie the owl-robot" : character === "shade" ? "The Shadow" : "The Ascender"} — ${state}`}
          width={px}
          height={px}
          className="h-auto w-full"
          fallback={
            <span className="grid aspect-square w-full place-items-center rounded-[28%] bg-[#F5F2EA] text-[#111114]" aria-hidden="true">
              <Icon name={FALLBACK_ICON[character]} size={Math.round(px / 2.4)} />
            </span>
          }
        />
      </div>
      {message && <figcaption className="max-w-[16rem] rounded-2xl bg-surface-1 px-3 py-1.5 text-center text-caption font-bold text-ink shadow-card">{message}</figcaption>}
    </figure>
  );
}

/** Hero state from what actually happened today (quest progress + rest day). */
export function heroStateFor(input: { restDay?: boolean; coreTier?: "seed" | "standard" | "stretch" | null; minutesToday?: number; focusGoalHit?: boolean }): HeroMascotState {
  if (input.restDay) return "tired";
  if (input.coreTier === "stretch") return "celebrate";
  if (input.coreTier === "standard" || input.coreTier === "seed") return "happy";
  if (input.focusGoalHit) return "celebrate";
  if ((input.minutesToday ?? 0) > 0) return "happy";
  return "idle";
}

/** Shade state from the rival gap (event: weekly duel / mastery points). */
export function shadeStateFor(gap: { userMp: number; shadowMp: number } | null): ShadeMascotState {
  if (!gap) return "smug";
  if (gap.userMp > gap.shadowMp) return "defeated";
  if (gap.userMp === gap.shadowMp) return "winner";
  return "smug";
}
