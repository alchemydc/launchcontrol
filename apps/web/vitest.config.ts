import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Force tests onto file:./test.db regardless of the developer's local .env.
    // Empty TURSO_* entries shadow any populated values so prisma migrate deploy
    // (which rejects libsql:// URLs) and the runtime adapter both pick the file URL.
    env: {
      DATABASE_URL: "file:./test.db",
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    // ingest test runs migrations via the CLI; give it room
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
