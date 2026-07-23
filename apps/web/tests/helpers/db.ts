import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** Path + connection-string pair for a fresh per-suite SQLite file, migrated
 *  (not seeded further) in `beforeAll`; deleted in `afterAll`. */
export function dbTarget(name: string): { path: string; url: string } {
  return {
    path: resolve(__dirname, "..", "..", `test-${name}.db`),
    url: `file:./test-${name}.db`,
  };
}

/** Apply the full migration chain (incl. seed migrations) to a fresh file DB. */
export function migrateDeploy(dbUrl: string) {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}
