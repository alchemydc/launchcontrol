import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

type ValidateOk = { ok: true; tempPath: string };
type ValidateErr = { ok: false; error: string };

export function validateAxdbBuffer(buf: Buffer): ValidateOk | ValidateErr {
  if (buf.length < SQLITE_MAGIC.length || !buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    return { ok: false, error: "not a SQLite database" };
  }

  const tempPath = join(tmpdir(), `axdb-${randomUUID()}.axdb`);
  writeFileSync(tempPath, buf);

  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(tempPath, { readonly: true });
    const row = db.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
    db.close();
    db = undefined;
    if (!row || row.quick_check !== "ok") {
      unlinkSync(tempPath);
      return { ok: false, error: "SQLite integrity check failed" };
    }
    return { ok: true, tempPath };
  } catch (err) {
    db?.close();
    try { unlinkSync(tempPath); } catch { /* best-effort */ }
    return { ok: false, error: err instanceof Error ? err.message : "SQLite open failed" };
  }
}
