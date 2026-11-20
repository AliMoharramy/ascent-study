import { requireUser } from "@/server/context";
import { listBackupsForApp } from "@/server/backup";
import { seedCounts } from "@/server/seed";
import { csvRows, ensureDefaultConfig, listConfigVersions } from "@/server/config";
import { examView } from "@/server/reference";
import { subjects } from "@/db/schema";
import { Card, Chip, Eyebrow, SectionTitle } from "@/ui/components";
import { SettingsClient } from "./SettingsClient";
import { GameSettings } from "./GameSettings";
import { ConfigEditor } from "./ConfigEditor";
import { goalView } from "@/server/reviews";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, user, userId, cfg, today } = await requireUser();
  const listing = await listBackupsForApp();
  const counts = (await seedCounts(db));
  const active = (await ensureDefaultConfig(db, userId));
  const versions = (await listConfigVersions(db, userId)).map(({ version, reason, createdAt }) => ({ version, reason, createdAt }));
  const csv = csvRows(active.config)
    .map((r) => r.join(","))
    .join("\n");
  const exam = (await examView(db));
  const subjectNames = new Map((await db.select({ id: subjects.id, nameFa: subjects.nameFa }).from(subjects)).map((s) => [s.id, s.nameFa]));
  return (
    <div className="grid gap-6">
      <SectionTitle>Settings</SectionTitle>
      <SettingsClient theme={user.theme as "night" | "cream"} backups={listing.backups} backupsSupported={listing.supported} />
      <GameSettings flags={cfg.flags} goal={(await goalView(db, userId, today)).goal.minutes} budget={cfg.shop.monthlyMoneyBudget} reminders={cfg.reminders} volume={cfg.sound.volume} />
      {exam && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Exam structure (seed)</Eyebrow>
            {exam.countsAssumed && <Chip tone="coral">Question counts are an assumption — not official</Chip>}
          </div>
          <p className="fa mt-2 text-body-s text-muted" lang="fa" dir="rtl">
            {exam.nameFa} · کد مجموعه {exam.groupCode} · کنکور {exam.yearJalali}
          </p>
          <table className="mt-3 w-full text-body-s">
            <thead>
              <tr className="text-left text-caption uppercase tracking-widest text-muted">
                <th className="py-1">Group</th>
                <th className="py-1">Coefficient</th>
                <th className="py-1">Share of weighted score</th>
              </tr>
            </thead>
            <tbody>
              {exam.groups.map((g) => (
                <tr key={g.id} className="border-t border-line">
                  <td className="fa py-1.5 font-bold" lang="fa" dir="rtl">
                    {g.name_fa}
                  </td>
                  <td className="py-1.5 font-extrabold">{g.coefficient}</td>
                  <td className="py-1.5">{(g.share * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-body-s">
            {exam.totalQuestions ?? "?"} questions · {exam.durationMin ?? "?"} min · wrong answer = −{exam.wrongPenalty} of a correct one
          </p>
          <table className="mt-3 w-full text-body-s">
            <thead>
              <tr className="text-left text-caption uppercase tracking-widest text-muted">
                <th className="py-1">Subject</th>
                <th className="py-1">Questions{exam.countsAssumed ? " (assumed)" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {exam.groups.flatMap((g) =>
                g.subjects.map((sid) => (
                  <tr key={sid} className="border-t border-line">
                    <td className="fa py-1.5" lang="fa" dir="rtl">
                      {subjectNames.get(sid) ?? sid}
                    </td>
                    <td className="py-1.5 font-bold">{exam.perSubject[sid] ?? "?"}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {exam.note && (
            <p className="fa mt-1 text-caption text-muted" lang="fa" dir="rtl">
              {exam.note}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {exam.coefficientsSourceUrl && /^https?:\/\//.test(exam.coefficientsSourceUrl) && (
              <a className="fa inline-block text-caption font-bold underline" lang="fa" dir="rtl" href={exam.coefficientsSourceUrl} target="_blank" rel="noreferrer noopener">
                منبع ضرایب: جدول رسمی مواد و ضرایب سازمان سنجش (بازنشر cshub)
              </a>
            )}
            {exam.sourceUrl && /^https?:\/\//.test(exam.sourceUrl) && (
              <a className="fa inline-block text-caption font-bold underline" lang="fa" dir="rtl" href={exam.sourceUrl} target="_blank" rel="noreferrer noopener">
                منبع تعداد سؤال (فرضی): آزمون آزمایشی cshub
              </a>
            )}
          </div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <Eyebrow>Knowledge map (seed)</Eyebrow>
          <p className="mt-2 text-body-s text-muted">
            {counts.subjects} subjects · {counts.chapters} chapters · {counts.requiredChapters} required map nodes · {counts.courses} courses
          </p>
        </Card>
        <div className="md:col-span-2">
          <ConfigEditor active={{ version: active.version, config: active.config }} versions={versions} csv={csv} />
        </div>
      </div>
    </div>
  );
}
