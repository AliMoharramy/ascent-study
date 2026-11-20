import { z } from "zod";
import { api, body } from "@/server/http";
import { gameDay } from "@/lib/time";
import {
  advanceTopic,
  bankBuilder,
  boardView,
  bondsView,
  builderView,
  claimBoard,
  escapeSeries,
  explorationView,
  identityVotesAll,
  logBond,
  logBuilder,
  logExploration,
  logReading,
  lootView,
  monthlyView,
  saveBond,
  saveTopic,
  streakView,
  voteIdentity,
} from "@/server/life";
import { leagueView } from "@/server/league";
import { saveStoryOverride, storyView } from "@/server/story";
import { afterLog } from "@/server/after";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  return {
    day: d,
    explore: (await explorationView(db, userId, d)),
    bonds: (await bondsView(db, userId, d)),
    builder: (await builderView(db, userId, d)),
    board: (await boardView(db, userId, d)),
    monthly: (await monthlyView(db, userId, d)),
    escape: (await escapeSeries(db, userId, d)),
    streak: (await streakView(db, userId, d)),
    loot: (await lootView(db, userId, d)),
    story: (await storyView(db, userId, d)),
    league: (await leagueView(db, userId, d)),
    identity: (await identityVotesAll(db, userId, d)),
  };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("topic"), id: z.string().max(40).optional(), title: z.string(), why: z.string().optional(), value: z.number().optional() }),
  z.object({ action: z.literal("topic-status"), id: z.string().max(40), status: z.enum(["backlog", "trial", "active", "archived"]), note: z.string().optional() }),
  z.object({ action: z.literal("explore"), topicId: z.string().max(40), minutes: z.number(), kind: z.enum(["trial", "review", "output"]).optional(), output: z.string().optional() }),
  z.object({ action: z.literal("bond"), id: z.string().max(40).optional(), name: z.string(), relation: z.string().optional(), reminderDays: z.number().optional() }),
  z.object({ action: z.literal("bond-log"), contactId: z.string().max(40), kind: z.enum(["message", "call", "meet", "collective"]), note: z.string().optional() }),
  z.object({ action: z.literal("reading"), book: z.string(), pages: z.number().optional(), minutes: z.number().optional(), note: z.string().optional() }),
  z.object({ action: z.literal("builder"), minutes: z.number(), built: z.string(), ideaId: z.string().nullish() }),
  z.object({ action: z.literal("builder-bank"), minutes: z.number(), reason: z.string().optional() }),
  z.object({ action: z.literal("board") }),
  z.object({ action: z.literal("identity"), habitId: z.string().nullish(), vote: z.enum(["for", "against"]), note: z.string().optional() }),
  z.object({ action: z.literal("story"), chapterNo: z.number(), startText: z.string().optional(), endText: z.string().optional() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  switch (b.action) {
    case "topic":
      return { id: (await saveTopic(db, userId, d, b, b.id)) };
    case "topic-status":
      (await advanceTopic(db, userId, d, b.id, b.status, b.note));
      return { ok: true };
    case "explore":
      return (await logExploration(db, userId, d, b));
    case "bond":
      return { id: (await saveBond(db, userId, b, b.id)) };
    case "bond-log":
      return (await logBond(db, userId, d, b));
    case "reading":
      return (await logReading(db, userId, d, b));
    case "builder":
      return (await logBuilder(db, userId, d, b));
    case "builder-bank":
      return (await bankBuilder(db, userId, d, b.minutes, b.reason ?? ""));
    case "board":
      return { ...(await claimBoard(db, userId, d)), ...(await afterLog(db, userId, d)) };
    case "identity":
      return (await voteIdentity(db, userId, d, b));
    case "story":
      return (await saveStoryOverride(db, userId, b));
  }
});
