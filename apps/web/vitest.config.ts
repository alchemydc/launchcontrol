import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    env: { DATABASE_URL: "file:./test.db" },
    // ingest test runs migrations via the CLI; give it room
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
