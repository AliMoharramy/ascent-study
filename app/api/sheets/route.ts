import { api } from "@/server/http";
import { sheetsView } from "@/server/sheets";

export const GET = api(async ({ db, userId, req }) => {
  const q = new URL(req.url).searchParams;
  const list = (k: string) => q.get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  return (await sheetsView(db, userId, { subjects: list("subjects"), chapters: list("chapters") }));
});