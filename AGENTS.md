# AGENTS.md

This file provides guidance to coding agents (Claude Code, etc.) when working with code in this repository.

## Repository shape

pnpm workspace. **All application code lives under `apps/web/`** — the repo root holds only docs, workspace config, and gitignored local data. Run every dev command from the root with `--filter web`, or `cd apps/web` first. Never scaffold new app code into the repo root.

`apps/web/CLAUDE.md` → `apps/web/AGENTS.md`: this is a bleeding-edge Next.js (App Router, Next 16 / React 19). APIs differ from training data — consult `node_modules/next/dist/docs/` before writing Next-specific code.

## Commands

All from repo root:

```sh
pnpm --filter web dev          # dev server on :3000
pnpm --filter web build        # production build
pnpm --filter web lint         # eslint (CI runs with --max-warnings 0 via lint-staged)
pnpm --filter web typecheck    # tsc --noEmit (strict, noUncheckedIndexedAccess)
pnpm --filter web test         # vitest run (a `pretest` hook rebuilds synthetic .axdb fixtures)
```

Run a single test file / test:

```sh
pnpm --filter web exec vitest run tests/ingest.test.ts
pnpm --filter web exec vitest run -t "name pattern"
```

Tests force `DATABASE_URL=file:./test.db` and blank the Turso vars, so they never touch a remote DB.

CI (`.github/workflows/ci.yml`, Node 22) runs, in order: install → `prisma generate` → lint → typecheck → test → build. Match that locally before pushing.

## Data / DB commands

```sh
pnpm --filter web ingest <path-to.axdb>   # ingest one AxWare file into the local DB
apps/web/scripts/ingest.sh <dir>          # batch-ingest every .axdb under a directory
pnpm --filter web wipe:db [--dry-run]      # drop all tables/views/triggers/indexes
pnpm --filter web migrate:turso            # apply prisma migrations to Turso (libSQL workaround)
```

DB ops against **Turso** (wipe + migrate + ingest) are run by the user manually after a preview deploy — the agent commits and opens the PR but does not automate Turso writes.

## Architecture

**Pipeline:** AxWare/VisualAX `.axdb` (a read-only SQLite export) → `src/lib/ingest.ts` (`ingestAxdb()`) → Prisma DB → server-component pages render leaderboards.

- **Ingest** (`src/lib/ingest.ts`): opens the `.axdb` with `better-sqlite3` read-only, asserts a single event, keeps only `status=3` (committed) runs, maps run disposition (`''→CLEAN`, plus `DNF/RRN/OFF/DSQ`), and **redacts surnames to a last initial** (`src/lib/pii.ts`) before persisting. Entry points: CLI `scripts/ingest.ts`, batch `scripts/ingest.sh`, and admin upload `POST /api/admin/ingest`.

### Driver identity hash

A driver's stable identity is `Driver.identityHash` (a unique column), computed by `computeIdentityHash()` in `src/lib/ingest.ts`:

```
identityHash = sha256( "<memberNum>|<firstName>|<lastName>" )
```

where `memberNum` is the trimmed VisualAX `member_num` (empty string if null) and `firstName`/`lastName` are lowercased and trimmed. The **full** last name is hashed at ingest time — but only the redacted `lastInitial` is ever stored, so the hash lets us recognize the same human across events without persisting the surname.

Why all three fields rather than just `member_num`: VisualAX's `member_num` is family/account-level, so distinct people can share one, and a co-driver may carry the primary's `member_num` or an empty one. Folding in first+last name disambiguates those. Two `.axdb` rows that hash to the same value are treated as one `Driver` (last write wins within a single source); a matching hash already in the DB updates that existing row instead of inserting.
- **DB:** Prisma 7 with `provider = "sqlite"`. Client in `src/lib/prisma.ts` picks the `PrismaLibSql` (Turso) adapter when `TURSO_DATABASE_URL` is set, else local `DATABASE_URL` (`file:./dev.db`). Schema + SQL migrations under `apps/web/prisma/`. Models: `Event`, `Driver`, `CarClass`, `Entry`, `Run`, `Video`.
- **App:** Next.js App Router, server components by default; gated routes use `export const dynamic = "force-dynamic"`. Key routes: `/events/[slug]`, `/leaderboard[/year]`, `/drivers/[id]`, `/admin` + `/admin/ingest`, `/me`. Leaderboard logic lives in `src/lib/leaderboard.ts`, `season-leaderboard.ts`, `entry-best.ts`, `driver-history.ts` — pages call these, not inline Prisma aggregation.
- **Auth:** MSR (MotorsportReg) OAuth 1.0a (`src/lib/msr.ts`, `msr-endpoints.ts`) + `iron-session` cookies (`src/lib/session.ts`). Member gating checks the user's MSR orgs against `MSR_RMR_ORG_ID`; admin gating checks `ADMIN_MSR_UIDS` (`src/lib/admin.ts`). Full surnames are never stored in the session.

## UI changes

Before implementing a UI/layout fix, confirm the actual root cause in-browser first (chrome-devtools MCP is configured) — don't fix the element you assume is responsible. After implementing, verify at both mobile and desktop breakpoints and confirm the responsive layout matches the existing pages.

## Domain invariants (easy to get wrong)

- **One class per driver per event.** A co-drive is a *separate* `Driver` row (number-suffix convention, e.g. `34` + `34X`), never the same driver in two classes at one event. `Entry` is intentionally **not** unique on `(eventId, driverId)`.
- **Only `CLEAN` runs score.** `DNF/RRN/OFF/DSQ` are persisted for audit but excluded from best-time/leaderboard math. Best time prefers `Entry.bestCommittedRunNumber` (AxWare's official pick), else `min(rawTimeMs + cones * CONE_PENALTY_MS)` over CLEAN runs.
- **`member_num` is family/account-level, not per-person** — never treat it as a unique person key. Driver identity is `identityHash` (see "Driver identity hash" above).
- **PII:** real `.axdb` files (under gitignored `real_season_data/`) contain member names, emails, and numbers. Never commit them, use them as CI fixtures, or put real surnames in docs/commits/PRs. Tests use synthetic fixtures only.

## Single-tenant note

Hardcoded for PCA Rocky Mountain Region for the MVP, but tenant identifiers (org IDs, SmugMug account/discipline) are **config, not code** — load from env (`MSR_RMR_ORG_ID`, `SMUGMUG_*`), no hardcoded org UUIDs.

## More detail

`docs/BUILD.md` (architecture, milestones, schema, OAuth flow, Turso rationale) and `docs/PRD.md` (requirements + glossary).
