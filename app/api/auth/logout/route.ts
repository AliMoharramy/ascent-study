import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { logout } from "@/server/auth";
import { CSRF_COOKIE, SESSION_COOKIE, api } from "@/server/http";

export const POST = api(async () => {
  const jar = await cookies();
  (await logout(getDb(), jar.get(SESSION_COOKIE)?.value));
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  return { ok: true };
});
