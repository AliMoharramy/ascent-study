// Local preview against a throwaway DB (data/preview/) so data/app.db stays clean.
import { spawn } from "node:child_process";
const env = { ...process.env, DATABASE_PATH: "./data/preview/app.db", BACKUP_DIR: "./data/preview/backups", COOKIE_SECURE: "false" };
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", process.argv[2] ?? "3100"], { env, stdio: "inherit" });
child.on("exit", (c) => process.exit(c ?? 0));
