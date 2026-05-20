import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // If TURSO_DATABASE_URL is set (and non-empty), use Turso (preview/prod).
  // Otherwise fall back to DATABASE_URL (defaults to file:./dev.db for local dev).
  // Empty strings count as unset so that `.env.example`-shaped local configs
  // (TURSO_DATABASE_URL=) do not accidentally route to a blank libsql URL.
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const url = tursoUrl || process.env.DATABASE_URL?.trim() || "file:./dev.db";
  const authToken = tursoUrl ? process.env.TURSO_AUTH_TOKEN : undefined;
  const adapter = new PrismaLibSql({ url, authToken });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
