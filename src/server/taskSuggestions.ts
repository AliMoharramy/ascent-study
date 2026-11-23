import { z } from "zod";
import type { Db } from "@/db/client";
import { listCourses, getCourse } from "./courses";
import { minutesForDay } from "./focus";
import { questsForDay } from "./quests";
import { remoteCall } from "./ai";
import { listPersonalTasks } from "./personalTasks";

const suggestionSchema = z.object({
  title: z.string().trim().min(4).max(140),
  reason: z.string().trim().min(4).max(240),
  estimatedMinutes: z.number().int().min(5).max(180),
});

const localSuggestion = (openCount: number) => ({
  title: openCount ? "Choose one open task for a focused 25-minute block" : "Plan one clear study task for your next focus block",
  reason: openCount ? "A short, uninterrupted session is a practical next step." : "A small concrete task makes it easier to begin.",
  estimatedMinutes: 25,
});

export async function taskSuggestion(db: Db, userId: string, today: string, shareTaskTitlesWithAi: boolean) {
  const [quests, personalTasks, courses, focusMinutes] = await Promise.all([
    questsForDay(db, userId, today),
    listPersonalTasks(db, userId),
    listCourses(db),
    minutesForDay(db, userId, today),
  ]);
  const courseDetails = await Promise.all(courses.map((course) => getCourse(db, course.id)));
  const openQuests = quests.filter((quest) => quest.status === "open" && quest.tierDone === null);
  const openLessons = courseDetails.flatMap((detail) => detail
    ? detail.lessons.filter((lesson) => lesson.status !== "done").map((lesson) => ({ courseTitle: detail.course.title, lesson }))
    : []);
  const openPersonalTasks = personalTasks.filter((task) => task.status === "open");
  const openCount = openQuests.length + openLessons.length + openPersonalTasks.length;

  const taskTitles = shareTaskTitlesWithAi
    ? [
        ...openQuests.map((task) => ({ source: "today", title: task.title })),
        ...openLessons.map(({ courseTitle, lesson }) => ({ source: "course", title: `${courseTitle}: ${lesson.title}` })),
        ...openPersonalTasks.map((task) => ({ source: "mine", title: task.title })),
      ].slice(0, 16)
    : undefined;

  const context = JSON.stringify({
    date: today,
    focusMinutesToday: Math.round(focusMinutes),
    openTaskCounts: { today: openQuests.length, courses: openLessons.length, mine: openPersonalTasks.length },
    ...(taskTitles ? { taskTitles } : {}),
  });
  const system = [
    "Suggest one concrete, achievable next study task for the user.",
    "Return only a JSON object with title, reason, and estimatedMinutes.",
    "Keep the task small enough to begin immediately; estimatedMinutes must be 5–180.",
    shareTaskTitlesWithAi
      ? "The user explicitly opted in to sharing task titles; use them only to choose a relevant next task."
      : "Task titles are private. Use only the aggregate counts and focus minutes; do not ask for or infer titles.",
  ].join(" ");

  const result = await remoteCall(
    db,
    userId,
    "task_suggestion",
    system,
    context,
    suggestionSchema,
    today,
    shareTaskTitlesWithAi
      ? "task suggestion: task titles included after user opt-in"
      : "task suggestion: aggregate counts only; task titles excluded",
  );
  if (result) return { provider: "remote" as const, suggestion: result.value };

  return { provider: "local" as const, suggestion: localSuggestion(openCount) };
}
