// npm run user:ensure -- [username] [password]   (defaults: DEV_USER/DEV_PASSWORD env or test / test-password-123)
// Idempotent: creates the user only if none exists, so `make dev` can run repeatedly. Development databases only.
import { closeDb, getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { SetupAlreadyCompleted, setupUser } from "../src/server/auth";

const username = (process.argv[2] ?? process.env.DEV_USER ?? "test").trim().toLowerCase();
const password = process.argv[3] ?? process.env.DEV_PASSWORD ?? "test-password-123";
const db = getDb();
try {
  const [existing] = await db.select({ id: users.id, username: users.username }).from(users).limit(1);
  if (existing) {
    console.log(`user ${existing.username} already exists (${existing.id}) — password left unchanged`);
  } else {
    try {
      const { id } = await setupUser(db, { username, name: "Dev Tester", password });
      console.log(`created ${username} (${id})`);
      console.log(`login: ${username} / ${password}`);
    } catch (error) {
      if (!(error instanceof SetupAlreadyCompleted)) throw error;
      console.log("a user was created concurrently — nothing to do");
    }
  }
} finally {
  await closeDb();
}
