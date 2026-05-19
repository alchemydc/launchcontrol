import "dotenv/config";
import { defineConfig } from "prisma/config";

// For migrate deploy: use TURSO_DATABASE_URL when set (preview/prod),
// otherwise fall back to DATABASE_URL (defaults to file:./dev.db for local dev).
const url =
  process.env.TURSO_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
