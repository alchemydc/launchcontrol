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
pnpm --filter web db:wipe [--dry-run]      # drop all tables/views/triggers/indexes
pnpm --filter web db:migrate               # apply prisma migrations to Turso (libSQL workaround)
pnpm --filter web classing:import --league <slug> <classing.yml>   # regenerate src/data/classing/<slug>.json from upstream YAML
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
- **DB:** Prisma 7 with `provider = "sqlite"`. Client in `src/lib/prisma.ts` picks the `PrismaLibSql` (Turso) adapter when `TURSO_DATABASE_URL` is set, else local `DATABASE_URL` (`file:./dev.db`). Schema + SQL migrations under `apps/web/prisma/`. Models: `Event`, `Driver`, `CarClass`, `Entry` (including its `paxIndexApplied` PAX snapshot column, see below), `Run`, `Video`, `AdminAuditLog`, `League`, `ScoringSystem`, `Season`, `LeagueMembership`, `SuperUser`. `Video` is schema-only (no write path yet — reserved for the future media hub); don't build features that assume video rows exist.
- **App:** Next.js App Router, server components by default; gated routes use `export const dynamic = "force-dynamic"`. Legacy (default-league) routes: `/events/[slug]`, `/leaderboard[/year]`, `/drivers/[id]`, `/admin` + `/admin/ingest`, `/me`. Multi-league public browsing: `/leagues` (directory of every `League` row), `/l/[league]` (league home = events list), `/l/[league]/leaderboard[/s/[seasonSlug]]`, `/l/[league]/events/[slug]` — all league-scoped, gated on *that* league's own `accessGate`. The one public league-scoped route is `/l/[league]/classing` (legacy alias `/classing`), which takes no gate at all — see the classing bullet below. Leaderboard logic lives in `src/lib/leaderboard.ts`, `season-leaderboard.ts`, `entry-best.ts`, `driver-history.ts` — pages call these, not inline Prisma aggregation.
- **Tenant/scoring model (`src/lib/league-config.ts`, `src/lib/league-resolve.ts`, `src/lib/scoring-policy.ts`):** tenant identity is DB data, not config — `League` (one row per club/tenant: branding, access gate, MSR org, SmugMug lookup), `Season` (one per league-year, addressed by a `slug` unique within its league — `resolveSeasonBySlug`/`activeSeason` in `src/lib/season-resolve.ts` — with `plannedEvents`, `minimumEvents`, and a required live `rulesetId` reference), and `ScoringSystem` (UI: Ruleset; named per league, e.g. "PCA Classic"; owns drop count/timing, cone penalty, PAX-section behavior, the **per-event points system**, and the complete PAX table). Editing a ruleset's policy immediately affects every assigned season; PAX-table edits affect existing entries only after the explicit per-season re-apply action. Qualification is intentionally independent of score drops: `Season.minimumEvents` decides Official vs. Provisional, while `ScoringPolicy.dropCount` decides how many scores are discarded. `DEFAULT_LEAGUE_SLUG` (env, default `pca-rmr`) selects which `League` row the **legacy, unprefixed routes** serve — legacy env vars (`MSR_ORG_ID`/`MSR_RMR_ORG_ID`, `SMUGMUG_USER`/`SMUGMUG_DISCIPLINE_PATH`) are honored only as a fallback when the League row leaves a field `null`. A deployment can host multiple `League` rows at once (see `/leagues`/`/l/[league]` above), each independently ingestable via `--league <slug>` on both ingest CLIs. Create leagues with `pnpm --filter web league:create` (`src/lib/create-league.ts`), seasons with `pnpm --filter web season:create` (`src/lib/create-season.ts`); ingest auto-creates a bare Season the first time it sees an event year with none.

  **Two-tier role model (`src/lib/admin.ts`, `src/lib/super-user.ts`, `src/lib/membership.ts`):** a **superuser** is global — bootstrapped irrevocably from the `ADMIN_MSR_UIDS` env allowlist (checked first, no DB read) or granted via a `SuperUser` row — and administers every league. Per-league roles live on `LeagueMembership` (`(leagueId, msrUid)` unique, `role` = `ADMIN` / `MEMBER` / `BLOCKED`), written via the admin UI (`/admin/leagues/[slug]/members`) and its REST route — no more manual `prisma studio` edits needed. `isLeagueAdmin(msrUid, leagueId)` (superuser OR that league's ADMIN row) gates one league's admin actions; `isAnyLeagueAdmin(msrUid)` (superuser OR ADMIN of any league) gates the coarse `/admin` entry point; `administeredLeagues(msrUid)` feeds the `/admin` league index.

  **Access decision chain (`decideLeagueAccess`, `src/lib/league-access.ts`, exact order):** superuser → allow; `BLOCKED` membership → deny; `ADMIN`/`MEMBER` membership → allow; `accessGate !== "required"` → allow; MSR org match (`session.msrOrgIds` includes the league's `msrOrgId`) → allow; else → redirect. `checkLeagueAccess`/`requireMember` (`src/lib/session.ts`) resolve this per-league, replacing the old default-league-only `isRmrMember` flag. **Both temporary guards that once refused a `"required"` gate on any non-default league are deleted** now that real per-league membership gating exists: `league-config.ts`'s `toLeagueConfig` no longer throws for that combination, and `league:create --gate required` is no longer refused (still defaults to `"optional"` when `--gate` is omitted). See `docs/BUILD.md`'s "League Admin (PR 3)" section for the full chain and PAX-snapshot semantics.
- **Auth:** MSR (MotorsportReg) OAuth 1.0a (`src/lib/msr.ts`, `msr-endpoints.ts`) + `iron-session` cookies (`src/lib/session.ts`). The session now carries `msrOrgIds` (every MSR org the user belongs to, captured at login) alongside `msrUid`/`isRmrMember`, so per-league org-match gating (above) doesn't need a fresh MSR API call. Admin gating is the two-tier `isLeagueAdmin`/`isAnyLeagueAdmin`/`isSuperUser` model above, not a flat `ADMIN_MSR_UIDS`-only check. Full surnames are never stored in the session.
- **PAX scoring reads an entry snapshot, not a live class join:** `Entry.paxIndexApplied` is stamped once at ingest (both pipelines) with the PAX factor in effect at that moment; `appliedPaxIndex()` (`src/lib/pax-applied.ts`) is what every scoring path (`leaderboard.ts`, `season-leaderboard.ts`) reads, falling back to the live `entry.paxClass.paxIndex` join only for the rare pre-snapshot row. `CarClass.paxIndex` itself remains the live/current factor — written fresh on every ingest and used as the ingest-time source for the snapshot — but never read directly by scoring once an entry has its own snapshot. The assigned ruleset owns the complete PAX table; `reapplySeasonPaxFactors()` re-stamps matching entries for one selected season after a table edit.
- **Vehicle classing is checked-in repo data, not DB rows** (`src/lib/classing.ts`, `classing-registry.ts`, `src/data/classing/<league-slug>.json`): which car runs in which class, per league, per season. Unlike `League`/`Season`/`ScoringSystem` — per-deployment tenant config that belongs in the DB — a classing table is a published rulebook that changes about once a season, wants PR review, and is read on every page that draws a class badge, where a DB lookup would cost a Turso round trip for data that never varies between deployments. `classing.ts` is pure (shape, validation, per-season grouping, lookup); `classing-registry.ts` owns the JSON imports and the league-slug registry, and is a separate module only so `scripts/classing-import.ts` can reuse the validator to *write* the files it reads. Upstream for `pca-rmr` is the YAML in `enginerdify/rmr-pca-classing` (also the source of the static table at rmr.pca.org) — re-run `classing:import` after pulling a new revision and commit the JSON diff. Adding a league is one JSON file plus one line in the registry; a league without one gets no `/classing` page (404), no subnav tab, and no class hover cards, all silently and correctly. Surfaces: the public `/l/[league]/classing` page (plus the legacy `/classing` alias for the default league) and the hover cards on `ClassBadge` (`src/components/class-badge.tsx`, the single class-badge component every results table now uses). **The classing page is deliberately ungated** — no PII, no results, and it is what a prospective entrant reads before deciding to show up; every results route keeps its existing gate.
- **The per-event points formula is ruleset policy (`ScoringPolicy` v4 `points`), not a constant:** `{ type: "ratio1000", basis: "class" }` scores each class section against its own fastest, so every class winner earns 1000 (PCA). `{ type: "ratio1000", basis: "event" }` scores every driver against the event's fastest indexed time, so a driver earns exactly **one** score per event, reused in their class section and in the synthetic PAX section — RMsolo's published rule, under which only the overall PAX winner ever scores 1000. `{ type: "position", table, beyondTable, basis }` maps finishing position onto an ordered table, with tied times sharing the higher position's points. The arithmetic lives in `awardPoints` (`src/lib/event-points.ts`), a pure function over a "lower is better" metric map; `basis` never reaches it, because the caller picks the population by choosing which map to pass. Section **membership** is independent of all of this — only the points value changes.

## UI changes

Before implementing a UI/layout fix, confirm the actual root cause in-browser first (chrome-devtools MCP is configured) — don't fix the element you assume is responsible. After implementing, verify at both mobile and desktop breakpoints and confirm the responsive layout matches the existing pages.

## Domain invariants (easy to get wrong)

- **One class per driver per event.** A co-drive is a *separate* `Driver` row (number-suffix convention, e.g. `34` + `34X`), never the same driver in two classes at one event. `Entry` is intentionally **not** unique on `(eventId, driverId)`.
- **Only `CLEAN` runs score.** `DNF/RRN/OFF/DSQ` are persisted for audit but excluded from best-time/leaderboard math. Best time prefers `Entry.bestCommittedRunNumber` (AxWare's official pick), else `min(rawTimeMs + cones * CONE_PENALTY_MS)` over CLEAN runs.
- **`member_num` is family/account-level, not per-person** — never treat it as a unique person key. Driver identity is `identityHash` (see "Driver identity hash" above).
- **PII:** real `.axdb` files (under gitignored `real_season_data/`) contain member names, emails, and numbers. Never commit them, use them as CI fixtures, or put real surnames in docs/commits/PRs. Tests use synthetic fixtures only.

## Multi-league note

A deployment can serve one `League` row or several. Tenant identity is **DB data, not config** — `League`/`Season` rows hold branding, the MSR org, and SmugMug lookup; `DEFAULT_LEAGUE_SLUG` selects which league the legacy, unprefixed routes serve (PCA Rocky Mountain Region by default); every league (including non-default ones) is also reachable at `/l/[league]`; scoring comes from each Season's live `ScoringSystem` ruleset reference, not a hardcoded formula. No hardcoded org UUIDs anywhere in code. Any league — default or not — may now use `accessGate: "required"`: per-league `LeagueMembership` roles and per-login `msrOrgIds` (see the "Two-tier role model" / "Access decision chain" notes above) resolve gating correctly for each league independently, so the old default-league-only restriction no longer applies.

## More detail

`docs/BUILD.md` (architecture, milestones, schema, OAuth flow, Turso rationale) and `docs/PRD.md` (requirements + glossary).
