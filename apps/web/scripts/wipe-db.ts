import { createInterface } from "node:readline/promises";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");

async function main(): Promise<void> {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const url = tursoUrl || process.env.DATABASE_URL?.trim() || "file:./dev.db";
  const authToken = tursoUrl ? process.env.TURSO_AUTH_TOKEN : undefined;
  const isTurso = Boolean(tursoUrl);

  const client = createClient({ url, authToken });

  const rs = await client.execute(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'trigger', 'index')"
  );
  const objects = rs.rows.map((r) => ({
    type: String(r.type),
    name: String(r.name),
  }));

  const tables = objects.filter((o) => o.type === "table");
  const views = objects.filter((o) => o.type === "view");
  const triggers = objects.filter((o) => o.type === "trigger");
  const indexes = objects.filter((o) => o.type === "index");

  const redactedUrl = isTurso
    ? (() => {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}`;
      })()
    : url;
  console.log(
    `Target: ${redactedUrl} (${isTurso ? "Turso" : "local"})`
  );

  if (objects.length === 0) {
    console.log("Database is already empty.");
    client.close();
    return;
  }

  console.log("Will drop:");
  for (const [label, group] of [
    ["table", tables],
    ["view", views],
    ["trigger", triggers],
    ["index", indexes],
  ] as [string, typeof tables][]) {
    const n = group.length;
    if (n === 0) continue;
    const names = group.map((o) => o.name).join(", ");
    console.log(`  ${n} ${label}${n !== 1 ? "s" : ""}  (${names})`);
  }

  if (dryRun) {
    client.close();
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (isTurso) {
      // Turso wipes are unrecoverable; require typing the exact hostname so an
      // accidental `--yes` in a script can't silently blast a production DB.
      const hostname = new URL(tursoUrl!).hostname;
      const answer = await rl.question(
        `Type the DB host name to confirm wipe: `
      );
      if (answer.trim() !== hostname) {
        console.error("Host name mismatch — aborting.");
        process.exit(2);
      }
    } else {
      if (!yes) {
        const answer = await rl.question(
          `Wipe local DB at ${url}? [y/N]: `
        );
        if (answer.trim().toLowerCase() !== "y") {
          console.error("Aborted.");
          process.exit(2);
        }
      }
    }
  } finally {
    rl.close();
  }

  // SQLite ignores `PRAGMA foreign_keys` set inside a transaction, so we set it
  // on the client first. With FKs off, drop order doesn't matter.
  await client.execute("PRAGMA foreign_keys = OFF");

  const tx = await client.transaction("write");
  try {
    for (const { name } of triggers) {
      await tx.execute(`DROP TRIGGER IF EXISTS "${name}"`);
    }
    for (const { name } of views) {
      await tx.execute(`DROP VIEW IF EXISTS "${name}"`);
    }
    for (const { name } of tables) {
      await tx.execute(`DROP TABLE IF EXISTS "${name}"`);
    }
    // belt-and-braces: any standalone indexes not implicitly dropped with their table
    for (const { name } of indexes) {
      await tx.execute(`DROP INDEX IF EXISTS "${name}"`);
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    client.close();
    console.error(e);
    process.exitCode = 1;
    return;
  } finally {
    tx.close();
  }

  client.close();

  console.log(
    `  →   Dropped ${tables.length} table${tables.length !== 1 ? "s" : ""}, ${views.length} view${views.length !== 1 ? "s" : ""}, ${triggers.length} trigger${triggers.length !== 1 ? "s" : ""}. Database is empty.`
  );
  console.log("  ok  Next step: pnpm --filter web db:migrate");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
