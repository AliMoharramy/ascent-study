// npm run user:create -- <username> "<display name>"   (password from ASCENT_PASSWORD env or prompt)
// Normally not needed: the site shows a first-run setup form when no user exists.
// The app is single-user: this uses the same atomic setup as the form, so it cannot create a second account.
import readline from "node:readline/promises";
import { closeDb, getDb } from "../src/db/client";
import { SetupAlreadyCompleted, setupUser } from "../src/server/auth";

const [username, name] = process.argv.slice(2);
if (!username) {
  console.error('usage: npm run user:create -- <username> "<display name>"');
  process.exit(1);
}
let password = process.env.ASCENT_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (≥ 10 chars): ");
  rl.close();
}
try {
  const { id } = await setupUser(getDb(), { username, name: name ?? username, password });
  console.log(`created ${username} (${id})`);
} catch (error) {
  if (error instanceof SetupAlreadyCompleted) {
    console.error("A user already exists; this app has exactly one account.");
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await closeDb();
}
