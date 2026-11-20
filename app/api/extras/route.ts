import { z } from "zod";
import { api, body } from "@/server/http";
import { avatarView, capsuleView, cardView, claimCard, claimSeason, drawWeeklyCard, finishRush, gemsView, rushInput, rushView, saveAvatar, sealCapsule, seasonView, skillsView, unlockSkill, avatarInput } from "@/server/extras";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  return { gems: (await gemsView(db, userId)), skills: (await skillsView(db, userId)), avatar: (await avatarView(db, userId)), season: (await seasonView(db, userId, d)), card: (await cardView(db, userId, d)), rush: (await rushView(db, userId, d)), capsule: (await capsuleView(db, userId, d)) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock"), skillId: z.string().max(20) }),
  z.object({ action: z.literal("avatar"), avatar: avatarInput }),
  z.object({ action: z.literal("season_claim"), week: z.number().int().min(1).max(25) }),
  z.object({ action: z.literal("card_draw") }),
  z.object({ action: z.literal("card_claim") }),
  z.object({ action: z.literal("rush_finish"), results: rushInput.shape.results }),
  z.object({ action: z.literal("capsule_seal"), text: z.string().max(4000) }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  switch (b.action) {
    case "unlock":
      return { skills: (await unlockSkill(db, userId, b.skillId, d)), gems: (await gemsView(db, userId)) };
    case "avatar":
      return { avatar: (await saveAvatar(db, userId, b.avatar, d)), gems: (await gemsView(db, userId)) };
    case "season_claim":
      return { season: (await claimSeason(db, userId, b.week, d)), gems: (await gemsView(db, userId)) };
    case "card_draw":
      return { card: (await drawWeeklyCard(db, userId, d)) };
    case "card_claim":
      return { card: (await claimCard(db, userId, d)), gems: (await gemsView(db, userId)) };
    case "rush_finish":
      return { rush: (await finishRush(db, userId, { results: b.results }, d)), gems: (await gemsView(db, userId)) };
    case "capsule_seal":
      return { capsule: (await sealCapsule(db, userId, b.text, d)) };
  }
});