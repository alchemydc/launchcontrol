import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigration } from "../scripts/migrate-turso";

// Regression test for the foreign-key cascade data-loss bug: when migrate-turso
// applied migrations inside an interactive transaction, `PRAGMA foreign_keys=OFF`
// (a no-op inside a transaction) was ignored, so a Prisma table-rebuild
// migration's `DROP TABLE` cascade-deleted child rows (e.g. Entry/Run when Event
// was rebuilt). applyMigration must run the script WITHOUT a wrapping
// transaction so the PRAGMA takes effect and children survive.

const DB = join(tmpdir(), `migrate-turso-test-${process.pid}.db`);

afterEach(() => rmSync(DB, { force: true }));

describe("applyMigration", () => {
  it("preserves child rows through a table-rebuild migration", async () => {
    const c = createClient({ url: `file:${DB}` });
    await c.executeMultiple(`
      CREATE TABLE "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL, "started_at" DATETIME, "applied_steps_count" INTEGER
      );
      CREATE TABLE "Parent" ("id" INTEGER PRIMARY KEY, "name" TEXT);
      CREATE TABLE "Child" (
        "id" INTEGER PRIMARY KEY, "parentId" INTEGER NOT NULL,
        CONSTRAINT "fk" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE
      );
      INSERT INTO "Parent" ("id","name") VALUES (1,'a'),(2,'b');
      INSERT INTO "Child" ("id","parentId") VALUES (10,1),(11,2),(12,1);
    `);

    // Precondition that makes the bug possible: libSQL defaults foreign_keys ON.
    const fk = (await c.execute("PRAGMA foreign_keys")).rows[0]!;
    expect(Number(fk.foreign_keys)).toBe(1);

    // The Prisma SQLite table-rebuild pattern (drops + recreates Parent).
    const rebuild = `
      PRAGMA defer_foreign_keys=ON;
      PRAGMA foreign_keys=OFF;
      CREATE TABLE "new_Parent" ("id" INTEGER PRIMARY KEY, "name" TEXT, "extra" TEXT);
      INSERT INTO "new_Parent" ("id","name") SELECT "id","name" FROM "Parent";
      DROP TABLE "Parent";
      ALTER TABLE "new_Parent" RENAME TO "Parent";
      PRAGMA foreign_keys=ON;
      PRAGMA defer_foreign_keys=OFF;
    `;
    await applyMigration(c, "20990101000000_rebuild_parent", rebuild);

    // Children must NOT have been cascade-deleted by the DROP TABLE.
    const child = Number((await c.execute(`SELECT COUNT(*) AS n FROM "Child"`)).rows[0]!.n);
    expect(child).toBe(3);
    // Parent rebuilt and preserved.
    const parent = Number((await c.execute(`SELECT COUNT(*) AS n FROM "Parent"`)).rows[0]!.n);
    expect(parent).toBe(2);
    // Migration recorded so it isn't re-applied.
    const recorded = (
      await c.execute(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
    ).rows.map((r) => String(r.migration_name));
    expect(recorded).toContain("20990101000000_rebuild_parent");

    c.close();
  });
});
