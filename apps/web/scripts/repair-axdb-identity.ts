// One-off operator tool: backfill blank/null member_num on VisualAX .axdb driver
// rows by cross-referencing the same (first_name, last_name) pair's member_num
// from OTHER .axdb exports under the same root directory.
//
// Background: two 2024 AxWare→VisualAX transition exports have member_num blank
// for every driver, splitting each human into a separate Driver row per event
// (see normalizeMemberNum() in src/lib/ingest.ts for the related "verified"
// suffix-drift fix). This script never touches originals — it writes patched
// copies to an --out-dir for the operator to re-ingest.
//
// Usage:
//   pnpm --filter web exec tsx scripts/repair-axdb-identity.ts <root-dir> [--write] [--out-dir <dir>]
//
// Default (no --write) is a dry-run report only. Pass --write to copy each file
// that has at least one patchable row into --out-dir (default: <root-dir>/patched)
// and apply the backfill to the copy.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import { normalizeMemberNum } from "@/lib/ingest";
import { redactLastName } from "@/lib/pii";

type DriverRow = {
  id: number;
  first_name: string;
  last_name: string;
  number: string;
  member_num: string | null;
};

type RowStatus = "patched" | "no-reference" | "ambiguous";

type RowReport = {
  redactedName: string;
  number: string;
  status: RowStatus;
  driverId: number;
  backfilled?: string;
};

function usage(): never {
  console.error(
    "Usage: pnpm --filter web exec tsx scripts/repair-axdb-identity.ts <root-dir> [--write] [--out-dir <dir>]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { rootDir: string; write: boolean; outDir: string | null } {
  const positional: string[] = [];
  let write = false;
  let outDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") {
      write = true;
    } else if (arg === "--out-dir") {
      const value = argv[++i];
      if (!value) usage();
      outDir = value;
    } else if (arg?.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    } else if (arg) {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) usage();
  return { rootDir: positional[0]!, write, outDir };
}

// Skip AxWare "Trailer Export" files (a different export shape) and anything
// staged under a `disabled` directory.
function shouldSkipFile(basename: string): boolean {
  return basename.includes("Trailer Export");
}

function shouldSkipDir(dirName: string): boolean {
  return dirName.toLowerCase() === "disabled";
}

function findAxdbFiles(root: string, excludeDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        if (full === excludeDir) continue; // never scan our own output as reference/target
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".axdb")) {
        if (shouldSkipFile(entry.name)) continue;
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

function nameKey(firstName: string, lastName: string): string {
  return `${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}`;
}

// Reference pass: (first, last) → set of distinct normalized member numbers
// seen for that name across every found .axdb file.
function buildReferenceMap(files: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const file of files) {
    const db = new Database(file, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT first_name, last_name, member_num FROM drivers")
        .all() as Array<{ first_name: string; last_name: string; member_num: string | null }>;
      for (const row of rows) {
        const normalized = normalizeMemberNum(row.member_num);
        if (normalized == null) continue;
        const key = nameKey(row.first_name, row.last_name);
        const set = map.get(key) ?? new Set<string>();
        set.add(normalized);
        map.set(key, set);
      }
    } finally {
      db.close();
    }
  }

  return map;
}

// Patch pass: for one file, classify every driver row with a blank/null
// member_num against the reference map.
function inspectFile(file: string, referenceMap: Map<string, Set<string>>): RowReport[] {
  const db = new Database(file, { readonly: true });
  try {
    const drivers = db
      .prepare("SELECT id, first_name, last_name, number, member_num FROM drivers")
      .all() as DriverRow[];

    const reports: RowReport[] = [];
    for (const d of drivers) {
      if (normalizeMemberNum(d.member_num) != null) continue; // already has a member_num

      const redactedName = `${d.first_name} ${redactLastName(d.last_name)}`;
      const candidates = referenceMap.get(nameKey(d.first_name, d.last_name));

      if (!candidates || candidates.size === 0) {
        reports.push({ redactedName, number: d.number, status: "no-reference", driverId: d.id });
      } else if (candidates.size === 1) {
        reports.push({
          redactedName,
          number: d.number,
          status: "patched",
          driverId: d.id,
          backfilled: [...candidates][0],
        });
      } else {
        reports.push({ redactedName, number: d.number, status: "ambiguous", driverId: d.id });
      }
    }
    return reports;
  } finally {
    db.close();
  }
}

function applyPatch(srcFile: string, destFile: string, patchable: RowReport[]): void {
  mkdirSync(dirname(destFile), { recursive: true });
  copyFileSync(srcFile, destFile);

  const db = new Database(destFile);
  try {
    const update = db.prepare("UPDATE drivers SET member_num = ? WHERE id = ?");
    const applyAll = db.transaction((rows: RowReport[]) => {
      for (const row of rows) {
        update.run(row.backfilled, row.driverId);
      }
    });
    applyAll(patchable);
  } finally {
    db.close();
  }
}

function main() {
  const { rootDir, write, outDir } = parseArgs(process.argv.slice(2));

  // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
  // so relative paths work the way the user expects (not relative to apps/web).
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const root = resolve(baseDir, rootDir);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Root directory not found or not a directory: ${root}`);
    process.exit(2);
  }

  const resolvedOutDir = outDir ? resolve(baseDir, outDir) : join(root, "patched");

  let files: string[];
  try {
    files = findAxdbFiles(root, resolvedOutDir);
  } catch (e) {
    console.error(`Failed to scan ${root}:`, e);
    process.exit(2);
  }

  if (files.length === 0) {
    console.log(`No .axdb files found under ${root}`);
    return;
  }

  const referenceMap = buildReferenceMap(files);

  let filesPatched = 0;
  let totalBackfilled = 0;

  for (const file of files) {
    const rows = inspectFile(file, referenceMap);
    const patched = rows.filter((r) => r.status === "patched");
    const noReference = rows.filter((r) => r.status === "no-reference");
    const ambiguous = rows.filter((r) => r.status === "ambiguous");

    console.log(`\n${relative(root, file)}`);
    console.log(
      `  patched=${patched.length} no-reference=${noReference.length} ambiguous=${ambiguous.length}`,
    );
    for (const r of rows) {
      if (r.status === "patched") {
        console.log(`    PATCH  ${r.redactedName}  #${r.number}  → member_num=${r.backfilled}`);
      } else if (r.status === "no-reference") {
        console.log(`    SKIP   ${r.redactedName}  #${r.number}  (no reference)`);
      } else {
        console.log(`    SKIP   ${r.redactedName}  #${r.number}  (ambiguous)`);
      }
    }

    if (patched.length > 0) {
      filesPatched++;
      totalBackfilled += patched.length;
      if (write) {
        const dest = join(resolvedOutDir, relative(root, file));
        applyPatch(file, dest, patched);
        console.log(`  -> wrote ${dest}`);
      }
    }
  }

  console.log(
    `\nSummary: ${files.length} files scanned, ${filesPatched} files ${write ? "patched" : "patchable"}, ${totalBackfilled} rows ${write ? "backfilled" : "to backfill"}.` +
      (write ? "" : " (dry run — pass --write to apply)"),
  );
}

main();
