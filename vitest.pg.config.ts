import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "src/**/*.pg.test.ts",
      "app/**/*.pg.test.ts",
      "scripts/**/*.pg.test.ts",
      "src/db/schema.test.ts",
      "src/events/projections.test.ts",
      "src/server/{services,game,intelligence,life,r45,r5,reference,rollover,seed}.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
