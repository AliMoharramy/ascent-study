// npm run user:reset-password — reset the single user's password, clear the lockout and sign everyone out.
// The new password comes from ASCENT_NEW_PASSWORD or a prompt. Point DATABASE_URL at the target database.
import readline from "node:readline/promises";
import { closeDb, getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { setPassword } from "../src/server/auth";

let password = process.env.ASCENT_NEW_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("New password (≥ 10 chars): ");
  rl.close();
}
const db = getDb();
try {
  const [user] = await db.select({ id: users.id, username: users.username }).from(users).limit(1);
  if (!user) {
    console.error("No user yet — open the site and complete first-run setup instead.");
    process.exitCode = 1;
  } else {
    await setPassword(db, user.id, password); // validates strength, clears lockout, deletes sessions — atomically
    console.log(`Password reset for "${user.username}". All sessions signed out.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Password reset failed");
  process.exitCode = 1;
} finally {
  await closeDb();
}
