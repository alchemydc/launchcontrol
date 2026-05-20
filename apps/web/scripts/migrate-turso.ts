// Apply prisma/migrations/* to a libSQL (Turso) database, in lex order.
//
// Workaround for Prisma 7.8: `prisma migrate deploy` rejects libsql:// URLs
// because the migration engine only understands file:/postgresql:/mysql:.
// This speaks the same _prisma_migrations protocol Prisma uses on SQLite, so
// applied rows are recognized by `prisma migrate deploy` if/when Prisma adds
// libsql adapter support — switching back later requires no state migration.
//
// Usage: pnpm --filter web migrate:turso
//   Requires TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN for hosted Turso) in env.
//   Falls back to DATABASE_URL — useful for smoke-testing against a local file: URL.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";

const MIGRATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  TEXT    PRIMARY KEY NOT NULL,
    "checksum"            TEXT    NOT NULL,
    "finished_at"         DATETIME,
    "migration_name"      TEXT    NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      DATETIME,
    "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );
`;

async function listAppliedMigrations(client: Client): Promise<Set<string>> {
  const rs = await client.execute(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
  );
  return new Set(rs.rows.map((r) => String(r.migration_name)));
}

function listMigrationDirs(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function main(): Promise<void> {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const url = tursoUrl || process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("TURSO_DATABASE_URL or DATABASE_URL must be set.");
    process.exit(2);
  }
  const authToken = tursoUrl ? process.env.TURSO_AUTH_TOKEN : undefined;

  const client = createClient({ url, authToken });
  const migrationsDir = resolve(__dirname, "..", "prisma", "migrations");

  let appliedCount = 0;
  let totalDirs = 0;
  try {
    await client.executeMultiple(MIGRATIONS_TABLE_DDL);
    const applied = await listAppliedMigrations(client);
    const dirs = listMigrationDirs(migrationsDir);
    totalDirs = dirs.length;

    for (const dir of dirs) {
      if (applied.has(dir)) {
        console.log(`  ok  ${dir} (already applied)`);
        continue;
      }
      const sql = readFileSync(
        resolve(migrationsDir, dir, "migration.sql"),
        "utf8"
      );
      const checksum = createHash("sha256").update(sql).digest("hex");

      console.log(`  →   ${dir}`);
      const tx = await client.transaction("write");
      try {
        await tx.executeMultiple(sql);
        await tx.execute({
          sql: `INSERT INTO _prisma_migrations
                  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
                VALUES (?, ?, current_timestamp, ?, current_timestamp, 1)`,
          args: [randomUUID(), checksum, dir],
        });
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
      console.log(`  ok  ${dir}`);
      appliedCount += 1;
    }
  } finally {
    client.close();
  }

  console.log(
    appliedCount === 0
      ? `Up to date — ${totalDirs} migrations already applied.`
      : `Applied ${appliedCount} new migration(s); ${totalDirs} total.`
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
