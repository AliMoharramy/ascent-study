import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "app/**/*.test.ts"],
    // PostgreSQL suites need a live server; they run via `npm run test:pg` (vitest.pg.config.ts).
    exclude: [
      ...configDefaults.exclude,
      "**/*.pg.test.ts",
      "src/db/schema.test.ts",
      "src/events/projections.test.ts",
      "src/server/{services,game,intelligence,life,r45,r5,reference,rollover,seed}.test.ts",
    ],
    pool: "forks",
  },
});
