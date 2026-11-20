/**
 * Story Bible (doc 04 §1) and deterministic Rival / Bonus dispatches.
 * Defaults live in code; every user can override the start/end text (issue #80).
 */

export interface StoryChapter {
  no: number;
  title: string;
  titleFa: string;
  weeks: string;
  start: string;
  end: string;
}

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    no: 1,
    title: "The Awakening",
    titleFa: "بیداری",
    weeks: "Week 1",
    start: "مه غلیظ است. از آنجا که ایستاده‌ای، قله دیده نمی‌شود. فقط یک مسیر هست — و امروز فقط یک گام. این هفته فقط مشاهده می‌کنی: همان‌گونه که هستی مطالعه کن و همه‌چیز را ثبت کن. هیچ جریمه‌ای نیست؛ سایه خواب است.",
    end: "بیداری تمام شد. حالا چهرهٔ واقعی روزهایت را دیده‌ای — نه آنکه آرزو داشتی. نقشه از همین‌جا شروع می‌شود: یک قلمرو، یک فصل، یک بلوک تمرکز در هر روز.",
  },
  {
    no: 2,
    title: "The Knowledge Lands",
    titleFa: "سرزمین دانش",
    weeks: "Weeks 2–19",
    start: "چهار قلمرو در افق پخش شده‌اند: ارگ ذهن‌ها، کارگاه ساختارها، برج ماشین و سیستم‌های عمیق. نمی‌توانی همه را هم‌زمان فتح کنی. Planner فقط نزدیک‌ترین فصل را نشانت می‌دهد.",
    end: "قلمروها روشن شده‌اند. برج هر فصلی که تمام کردی، نور را تا دیوار بعدی می‌برد. مه عقب‌نشینی می‌کند، اما هنوز آزمون اصلی در پیش است.",
  },
  {
    no: 3,
    title: "The Trials",
    titleFa: "آزمون‌ها",
    weeks: "Weeks 20–21",
    start: "دیگر یادگیری کافی نیست. آزمون‌ها شروع شده‌اند و ضعف‌ها از پشت دیوارها بیرون می‌آیند. دور دوم نظریه و شکار خطاها آغاز می‌شود؛ هر پاسخ غلط یک نقشهٔ کوچک است.",
    end: "دور دوم بسته شد. حالا می‌دانی کجا می‌شکنی و کجا می‌ایستی. این دانستن، از هر درصد خامی ارزشمندتر است.",
  },
  {
    no: 4,
    title: "The Arena",
    titleFa: "میدان",
    weeks: "Weeks 22–24",
    start: "دروازه‌های میدان باز شد. آزمون‌های بزرگ و سایهٔ رقیب یک قدم جلوتر ایستاده‌اند. اینجا کسی تعارف نمی‌کند؛ فقط ریتم و آمار حرف می‌زنند.",
    end: "میدان خالی شد. سایه یا جلو افتاد یا عقب ماند — اما تو یاد گرفتی زیر فشار هم همان کسی باشی که در تمرین بودی.",
  },
  {
    no: 5,
    title: "The Final Ascent",
    titleFa: "صعود نهایی",
    weeks: "Week 25",
    start: "قله نزدیک است و هوا رقیق. این هفته چیز تازه‌ای یاد نمی‌گیری؛ مرور می‌کنی، می‌خوابی و آرام می‌مانی. صعود نهایی با آرامش برده می‌شود، نه با هیجان.",
    end: "آخرین پله زیر پایت است. هرچه لازم بود ساختی: نقشه، ریتم، شواهد و استراحت. فردا فقط یک آزمون است — نه هویتت.",
  },
  {
    no: 6,
    title: "The Summit",
    titleFa: "قله",
    weeks: "Exam day",
    start: "قله دیگر نماد نیست؛ یک صبح معمولی است با یک آزمون بزرگ. نفس بکش. اولین سؤال را بخوان. بقیهٔ مسیر را قبلاً هزار بار رفته‌ای.",
    end: "از قله پایین می‌آیی. نتیجه هرچه باشد، این صعود مال توست: روزهایی که کسی ندید، خطاهایی که تحلیل شد و عادت‌هایی که ماندند. جشن کوچکی بگیر — و بعد استراحت.",
  },
];

/** Campaign week → story chapter; week 26+ is the Summit (exam day). */
export function chapterForWeek(weekNo: number): StoryChapter {
  if (weekNo <= 1) return STORY_CHAPTERS[0]!;
  if (weekNo <= 19) return STORY_CHAPTERS[1]!;
  if (weekNo <= 21) return STORY_CHAPTERS[2]!;
  if (weekNo <= 24) return STORY_CHAPTERS[3]!;
  if (weekNo <= 25) return STORY_CHAPTERS[4]!;
  return STORY_CHAPTERS[5]!;
}

export function applyStoryOverrides(
  chapter: StoryChapter,
  overrides: { chapterNo: number; startText: string; endText: string }[],
): StoryChapter {
  const o = overrides.find((x) => x.chapterNo === chapter.no);
  return o ? { ...chapter, start: o.startText || chapter.start, end: o.endText || chapter.end } : chapter;
}

export interface RivalEvent {
  kind: "rival" | "bonus";
  title: string;
  text: string;
  tone: "mint" | "coral" | "yellow";
}

/** Deterministic dispatches from the live rival state — same week, same words. */
export function rivalEvents(input: { weekNo: number; enabled: boolean; gap: number; duelsWonThisWeek: number; nextBoss: string | null }): RivalEvent[] {
  const i = input.weekNo % 3;
  if (!input.enabled) {
    return [
      { kind: "rival", title: "The Shadow rests", text: "No rival is tracking you this week. The only pace that matters is the one in your planner.", tone: "mint" },
      { kind: "bonus", title: "Quiet bonus", text: "A free Builder Hour? Not yet — Builder opens only with ≥ 70 % consistency and four Core days.", tone: "yellow" },
    ];
  }
  const ahead: RivalEvent[] = [
    { kind: "rival", title: "The Shadow falters", text: "Shadow تعارف نمی‌کند، اما این هفته جلو افتادی. فاصله را با یک Core دیگر باز کن — نه با هیجان.", tone: "mint" },
    { kind: "rival", title: "Ahead on the ridge", text: "You are ahead of the ideal path. The Shadow is still climbing; do not turn around to watch it.", tone: "mint" },
    { kind: "rival", title: "Keep the gap", text: "Being ahead is not a trophy — it is a buffer for the week you get sick. Bank one more Standard day.", tone: "mint" },
  ];
  const behind: RivalEvent[] = [
    { kind: "rival", title: "The Shadow advances", text: "سایه جلو افتاد. یک Comeback کوچک کافی است تا مسیر دوباره نزدیک شود — نه یک روز قهرمانانه.", tone: "coral" },
    { kind: "rival", title: "Behind the ridge", text: "The Shadow is ahead because the plan never skips. Steal back one block today; the gap is not identity.", tone: "coral" },
    { kind: "rival", title: "Fog at your heels", text: "Being behind is data, not a verdict. Choose the smallest Standard you can still finish today.", tone: "coral" },
  ];
  const rival: RivalEvent = (input.gap >= 0 ? ahead : behind)[i]!;
  const bonus: RivalEvent = input.duelsWonThisWeek > 0
    ? { kind: "bonus", title: "Duel bonus banked", text: `You won ${input.duelsWonThisWeek} duel${input.duelsWonThisWeek > 1 ? "s" : ""} this week: +${input.duelsWonThisWeek}h Builder Hour is added at the week's gate (cap 3 h).`, tone: "yellow" }
    : { kind: "bonus", title: input.nextBoss ? `Bonus: ${input.nextBoss}` : "Bonus objective", text: "Defeat this week's boss to add +1 h to next week's Builder Hour. The Vault stays closed until the week's gate.", tone: "yellow" };
  return [rival, bonus];
}
