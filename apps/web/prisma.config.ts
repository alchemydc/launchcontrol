import "dotenv/config";
import { defineConfig } from "prisma/config";

// For migrate deploy: use TURSO_DATABASE_URL when set (preview/prod),
// otherwise fall back to DATABASE_URL (defaults to file:./dev.db for local dev).
// Empty strings count as unset so that `.env.example`-shaped local configs
// (TURSO_DATABASE_URL=) do not break `prisma migrate deploy` — which rejects
// libsql:// URLs and would also reject an empty URL.
const url =
  process.env.TURSO_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
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
