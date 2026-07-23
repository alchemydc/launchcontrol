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
pnpm --filter web ingest [--league <slug>] <path-to.axdb>          # ingest one AxWare file (default: DEFAULT_LEAGUE_SLUG)
apps/web/scripts/ingest.sh <dir>                                   # batch-ingest every .axdb under a directory
pnpm --filter web ingest:rmsolo [--league <slug>] [--file <pdf> --date YYYY-MM-DD]  # RMsolo pipeline; no --file scrapes the results index
pnpm --filter web league:create --slug <slug> --name <name> [--gate required|optional|none] ...
pnpm --filter web season:create --league <slug> --name <name> --year <n> [--slug <slug>] ...
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

where `memberNum` is the trimmed VisualAX `member_num` with any trailing `verified` suffix stripped (`normalizeMemberNum()` — handles `N`, `N verified`, `N-verified`, any case; empty string if null/blank) and `firstName`/`lastName` are lowercased and trimmed. The **full** last name is hashed at ingest time — but only the redacted `lastInitial` is ever stored, so the hash lets us recognize the same human across events without persisting the surname.

Why all three fields rather than just `member_num`: VisualAX's `member_num` is family/account-level, so distinct people can share one, and a co-driver may carry the primary's `member_num` or an empty one. Folding in first+last name disambiguates those. Two `.axdb` rows that hash to the same value are treated as one `Driver` (last write wins within a single source); a matching hash already in the DB updates that existing row instead of inserting.

**Self-healing for blank-`member_num` legacy files:** some 2024 AxWare-transition exports have `member_num` blank for every driver, which would otherwise split one human into a separate `Driver` row per event. `Driver.nameOnlyHash` (`sha256("<firstName>|<lastName>")`, lowercased/trimmed, nullable — pre-existing rows can't be backfilled since the full surname is never stored) gives ingest a full-name-only key to fall back on whenever an `identityHash` lookup misses:
- A **blank** row (normalized `memberNum` is null) merges into the existing **populated** `Driver` sharing its `nameOnlyHash`, instead of creating a new row.
- A **populated** row "**adopts**" a pre-existing **blank** `Driver` sharing its `nameOnlyHash`, updating that row's `memberNum`/`identityHash`/`firstName`/`lastInitial` in place — so a later, better-identified export of the same legacy-era human still lands on the same row.
- Both only merge/adopt when there is **exactly one** candidate; 0 or ≥2 (e.g. two different populated drivers who happen to share a full name) leaves the status quo — a new, separate `Driver` row — rather than guessing. Because resolution only sees data ingested so far, ingesting chronologically maximizes merge confidence.
- **DB:** Prisma 7 with `provider = "sqlite"`. Client in `src/lib/prisma.ts` picks the `PrismaLibSql` (Turso) adapter when `TURSO_DATABASE_URL` is set, else local `DATABASE_URL` (`file:./dev.db`). Schema + SQL migrations under `apps/web/prisma/`. Models: `Event`, `Driver`, `CarClass`, `Entry`, `Run`, `Video`, `AdminAuditLog`, `League`, `ScoringSystem`, `Season`, `LeagueMembership`. `Video` is schema-only (no write path yet — reserved for the future media hub); don't build features that assume video rows exist.
- **App:** Next.js App Router, server components by default; gated routes use `export const dynamic = "force-dynamic"`. Legacy (default-league) routes: `/events/[slug]`, `/leaderboard[/year]`, `/drivers/[id]`, `/admin` + `/admin/ingest`, `/me`. Multi-league public browsing: `/leagues` (directory of every `League` row), `/l/[league]` (league home = events list), `/l/[league]/leaderboard[/s/[seasonSlug]]`, `/l/[league]/events/[slug]` — all league-scoped, gated on *that* league's own `accessGate`. Leaderboard logic lives in `src/lib/leaderboard.ts`, `season-leaderboard.ts`, `entry-best.ts`, `driver-history.ts` — pages call these, not inline Prisma aggregation.
- **Tenant/scoring model (`src/lib/league-config.ts`, `src/lib/league-resolve.ts`, `src/lib/scoring-policy.ts`):** tenant identity is DB data, not config — `League` (one row per club/tenant: branding, access gate, MSR org, SmugMug lookup), `Season` (one per league-year, addressed by a `slug` unique within its league — `resolveSeasonBySlug`/`activeSeason` in `src/lib/season-resolve.ts` — with `scoringPolicy` a JSON snapshot copied from a `ScoringSystem` preset at creation time, never a live reference), and `ScoringSystem` (named presets, e.g. "PCA Classic"). `DEFAULT_LEAGUE_SLUG` (env, default `pca-rmr`) selects which `League` row the **legacy, unprefixed routes** serve — legacy env vars (`MSR_ORG_ID`/`MSR_RMR_ORG_ID`, `SMUGMUG_USER`/`SMUGMUG_DISCIPLINE_PATH`) are honored only as a fallback when the League row leaves a field `null`. A deployment can host multiple `League` rows at once (see `/leagues`/`/l/[league]` above), each independently ingestable via `--league <slug>` on both ingest CLIs. Create leagues with `pnpm --filter web league:create` (`src/lib/create-league.ts`), seasons with `pnpm --filter web season:create` (`src/lib/create-season.ts`); ingest auto-creates a bare Season the first time it sees an event year with none. `src/lib/admin.ts`'s `isAdmin()` is a `LeagueMembership` compatibility shim on top of the pre-existing `ADMIN_MSR_UIDS` allowlist — the env allowlist is checked first and short-circuits before any DB read, then falls through to an ADMIN `LeagueMembership` row on the default league (no UI writes these rows yet — `prisma studio` only).

  **Operational invariant:** only the default league may use `accessGate: "required"`. Per-login MSR membership (`isRmrMember`, computed at OAuth callback time) is checked against the *default* league's `msrOrgId` only — `LeagueMembership` (per-league roles) exists in the schema but nothing writes or reads it for gating yet. A non-default league configured with `accessGate: "required"` therefore gates on the wrong org's membership (see `src/lib/session.ts`'s `requireMember` doc comment). `league:create --gate` defaults to `"required"` and does **not** refuse this today — every non-default league must be created with `--gate optional` or `--gate none` until per-league membership ships (PR 3 territory).
- **Auth:** MSR (MotorsportReg) OAuth 1.0a (`src/lib/msr.ts`, `msr-endpoints.ts`) + `iron-session` cookies (`src/lib/session.ts`). Member gating checks the user's MSR orgs against `MSR_RMR_ORG_ID`; admin gating checks `ADMIN_MSR_UIDS` (`src/lib/admin.ts`). Full surnames are never stored in the session.

## UI changes

Before implementing a UI/layout fix, confirm the actual root cause in-browser first (chrome-devtools MCP is configured) — don't fix the element you assume is responsible. After implementing, verify at both mobile and desktop breakpoints and confirm the responsive layout matches the existing pages.

## Domain invariants (easy to get wrong)

- **One class per driver per event.** A co-drive is a *separate* `Driver` row (number-suffix convention, e.g. `34` + `34X`), never the same driver in two classes at one event. `Entry` is intentionally **not** unique on `(eventId, driverId)`.
- **Only `CLEAN` runs score.** `DNF/RRN/OFF/DSQ` are persisted for audit but excluded from best-time/leaderboard math. Best time prefers `Entry.bestCommittedRunNumber` (AxWare's official pick), else `min(rawTimeMs + cones * CONE_PENALTY_MS)` over CLEAN runs.
- **`member_num` is family/account-level, not per-person** — never treat it as a unique person key. Driver identity is `identityHash` (see "Driver identity hash" above).
- **PII:** real `.axdb` files (under gitignored `real_season_data/`) contain member names, emails, and numbers. Never commit them, use them as CI fixtures, or put real surnames in docs/commits/PRs. Tests use synthetic fixtures only.

## Multi-league note

A deployment can serve one `League` row or several. Tenant identity is **DB data, not config** — `League`/`Season` rows hold branding, the MSR org, and SmugMug lookup; `DEFAULT_LEAGUE_SLUG` selects which league the legacy, unprefixed routes serve (PCA Rocky Mountain Region by default); every league (including non-default ones) is also reachable at `/l/[league]`; scoring is per-`Season` policy snapshots (`ScoringSystem` presets), not a hardcoded formula. No hardcoded org UUIDs anywhere in code. See the "Operational invariant" note above before setting a non-default league's `accessGate` to `"required"`.

## More detail

`docs/BUILD.md` (architecture, milestones, schema, OAuth flow, Turso rationale) and `docs/PRD.md` (requirements + glossary).
