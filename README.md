<img width="1280" height="640" alt="launchcontrol_gh" src="https://github.com/user-attachments/assets/23b59229-f785-4e02-b6e8-25a5834578c3" />

# Launch Control

A web platform for autocross clubs — event results, season standings, and event media. One deployment can serve several clubs at once, each with its own branding, access policy, ingest pipeline, and scoring rules; or a club can self-host its own instance.

**Live at [launchcontrol.club](https://launchcontrol.club)** — the reference deployment, serving results and standings for both PCA Rocky Mountain Region and SCCA Rocky Mountain Solo.

## What's here

- Per-event leaderboards (raw, PAX, and per-class)
- Season-long points standings, with drop rules and cone penalty configured per league
- Per-driver progression charts across a season, filterable to one league or aggregated across all
- Multi-league hosting: a public league directory and per-league routes, each gated independently
- League, season, and ruleset administration in-app — no redeploy or direct DB access to stand up a club
- Two ingest pipelines: VisualAX `.axdb` exports and RMsolo results PDFs
- SmugMug event gallery links, configured per league
- MSR single-sign-on, with two-tier roles (deployment superuser + per-league admin/member)

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui · Prisma · Turso (libSQL) · Vercel

## Quickstart

```sh
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm --filter web dev
```

Open http://localhost:3000. See [docs/BUILD.md](docs/BUILD.md) for ingest CLI, schema migration, and Turso ops.

## Leagues & Seasons

Tenant config lives in the database, not environment variables. A deployment's branding, access rule, and scoring all resolve from `League`/`Season`/`ScoringSystem` rows — see `apps/web/.env.example` for connection/secrets config (DB, MSR, SmugMug, session).

- **`League`** — one row per club/tenant: site branding (name, title, description, footer), the MSR access gate and org, and SmugMug lookup defaults. `DEFAULT_LEAGUE_SLUG` (env, default `pca-rmr`) names which `League` row the **legacy, unprefixed routes** (`/`, `/leaderboard[/year]`, `/events/[slug]`, `/drivers/[id]`) serve — a fresh DB seeds the `pca-rmr` row via the League Foundation migration, reproducing the original production deployment byte-for-byte. A deployment isn't limited to one league, though: every `League` row is also publicly browsable at its own `/l/[league]` URLs (see "Multi-league browsing" below), so one deployment can host several clubs side by side.
- **`ScoringSystem`** (UI: **Ruleset**) — named scoring configuration owned by a league (e.g. "PCA Classic"), including its policy and complete PAX-factor table.
- **`Season`** — one per league-year, addressed by a `slug` unique within its league (defaults to `slugify(name)`; multiple seasons in the same year are allowed — each gets its own slug, e.g. a "2026 Summer Series" and a later "2026 Winter Series"). Each season points to a Ruleset by live reference, so policy edits immediately affect every assigned season. Existing entries retain their applied PAX factors until an admin explicitly re-applies the edited table to that season.

### Multi-league browsing

- **`/leagues`** — directory of every `League` row on the deployment (name, active-season summary, event counts).
- **`/l/[league]`** — that league's home page (events list), **`/l/[league]/leaderboard`** (active/latest season) or **`/l/[league]/leaderboard/s/[seasonSlug]`** (a specific season), and **`/l/[league]/events/[slug]`** — all league-scoped, respecting that league's own `accessGate`.
- The **legacy, unprefixed routes** (`/`, `/leaderboard[/year]`, `/events/[slug]`) are unchanged and always serve `DEFAULT_LEAGUE_SLUG` — existing bookmarks into the default league are unaffected.
- The site header shows a "Leagues" nav link only when the deployment hosts more than one league.

### CLIs

For a complete fresh-database walkthrough, including the required Poppler
system package, see [RMsolo local setup and ingest](docs/RMSOLO.md).

Create a new league (a fresh tenant — site branding, access gate, and a default scoring preset in one step):

```sh
pnpm --filter web league:create --slug rmsolo --name "Rocky Mountain Solo" \
  [--title <title>] [--description <text>] [--footer <text>] [--landing <text>] \
  [--gate required|optional|none] [--preset-name <name>] [--policy-file ./policy.json]
```

`--gate` defaults to `"optional"` when omitted. `--gate required` is now accepted for any league, not just the seeded `pca-rmr` default — per-league membership gating (`LeagueMembership` roles, MSR org match against `session.msrOrgIds`) resolves access correctly per league, so a non-default `"required"` league no longer mis-gates on the wrong org (see "Operational note" below, now describing the current behavior rather than a restriction). `league:create` also creates the league's first Ruleset: `--policy-file` if given, else a PCA-shaped default (fixed drops, no PAX section, 2000ms cone penalty). Season creation and ingest auto-creation use the league's oldest Ruleset when none is named.

Create a new season with:

```sh
pnpm --filter web season:create --league pca-rmr --name "2027 Season" --year 2027 --planned 6 \
  [--slug 2027-season] [--preset "PCA Classic"]
```

`--slug` defaults to `slugify(name)`. `--preset` selects an existing Ruleset by name (the option name is retained for CLI compatibility). Multiple seasons per (league, year) are allowed as long as their slugs differ within that league — this is what makes a mid-year second series (e.g. a Winter Series alongside a Summer Series) addressable.

Ingest supports a `--league <slug>` flag on both pipelines (defaults to `DEFAULT_LEAGUE_SLUG` when omitted):

```sh
pnpm --filter web ingest --league rmsolo <path-to.axdb>
pnpm --filter web ingest:rmsolo --league rmsolo --file <pdf> --date YYYY-MM-DD [--name "Event name"]
pnpm --filter web ingest:rmsolo --league rmsolo   # no --file: scrapes the RMsolo results index instead
```

**ScoringPolicy v3** (stored on `ScoringSystem.policy`):

| Field | Values | Meaning |
|---|---|---|
| `v` | `3` | Policy schema version. |
| `dropCount` | non-negative integer | Number of lowest season scores discarded once the season is complete. |
| `dropTiming` | `"fixed"` \| `"proportional"` | fixed: use the season-end counted target throughout the season (PCA). proportional: scale drops with events completed (RMsolo). |
| `paxSection` | boolean | Render a synthetic overall-PAX standings section, pinned first. |
| `conePenaltyMs` | number | Milliseconds added per cone struck (PCA convention: 2000). Threaded end-to-end into per-entry corrected-time math. |

`League.footerText` renders verbatim in the site footer when set; a league with `footerText` left `null` falls back to the generic **"Powered by Launch Control"** string.

### Two-league local bring-up walkthrough

Migrations seed only the default `pca-rmr` league. The exact commands to stand
up RMsolo alongside it are:

```sh
# 1. Create the league and its RMsolo championship ruleset.
pnpm --filter web league:create --slug rmsolo --name "Rocky Mountain Solo" \
  --gate optional --preset-name "RMsolo Championship" \
  --policy-file apps/web/config/rmsolo-championship-policy.json

# 2. Create the season with that live ruleset reference.
pnpm --filter web season:create --league rmsolo --name "2026 Championship Series" --year 2026 \
  --planned 10 --minimum-events 6 --preset "RMsolo Championship"

# 3. Ingest RMsolo results into that league (scrapes the RMsolo results index;
#    pass --file/--date instead to ingest one PDF).
pnpm --filter web ingest:rmsolo --league rmsolo

# 4. Browse it.
pnpm --filter web dev
# open http://localhost:3000/leagues
```

RMsolo ingest requires the `pdftotext` executable from Poppler. It is a system
dependency (`poppler-utils` on Debian/Ubuntu, `poppler` via Homebrew on macOS),
not a Node package. See [the RMsolo runbook](docs/RMSOLO.md) for installation,
verification, idempotency, supported formats, and how the authenticated admin
ingest route relates to the CLI.

**Operational note:** any league — default or not — may run with `accessGate: "required"`. Per-league membership gating resolves access independently for each league: a `LeagueMembership` row (`ADMIN`/`MEMBER` allows, `BLOCKED` denies) takes precedence, and failing that, an MSR org match checks the *viewer's* `session.msrOrgIds` (captured at login) against *that specific league's* `msrOrgId` — not just the default league's, as in earlier PRs. `--gate` still defaults to `"optional"` on `league:create` since most self-hosted leagues won't want a login wall, but passing `--gate required` is no longer refused.

**`SESSION_SECRET` is required** whenever the *default* league's `accessGate` is `"required"` — that's the seeded `pca-rmr` config, so any deployment serving it (including this local walkthrough, since `pca-rmr` stays the default league) needs `SESSION_SECRET` set in `apps/web/.env`, or every gated page 500s. Generate one with `openssl rand -hex 32`.

### Driver stats filters

`/drivers/[id]` accepts query params to scope its stats: `?league=<slug>` (or `league=all` to combine leagues; default is the legacy single-league scope) crossed with a time scope — `?season=<seasonId>` for one season, `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a custom range, or no time param at all for all-time. Event/podium/points counts aggregate across leagues when `league=all`; progression and time-delta charts always render one series per league (never mixed on one axis).

The season leaderboard's **Avg** column is the driver's championship average points (total points ÷ counted scores, i.e. dropped scores excluded) — a quick read on scoring pace independent of how many events a driver has attended.

## Docs

See [docs/BUILD.md](docs/BUILD.md) for architecture and milestone history, [docs/PRD.md](docs/PRD.md) for requirements, [docs/RMSOLO.md](docs/RMSOLO.md) for the RMsolo ingest runbook, and [docs/dependabot.md](docs/dependabot.md) for the dependency-update runbook.

## License

Copyright (C) 2026 David Campbell and BJ Fulton.

Licensed under the [GNU General Public License v3.0 or later](LICENSE). This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the LICENSE file for details.
