<img width="1280" height="640" alt="launchcontrol_gh" src="https://github.com/user-attachments/assets/23b59229-f785-4e02-b6e8-25a5834578c3" />

# PCA Launch Control

A community web platform for the Porsche Club of America Rocky Mountain Region — autocross results, season standings, and event media.

**Live at [launchcontrol.club](https://launchcontrol.club)** — see the 2026 RMR season standings, per-event leaderboards, and driver progression charts.

## What's here

- Per-event leaderboards (raw, PAX, and per-class)
- Season-long points standings (best 4 of 7 events per class)
- Per-driver progression charts across the season
- SmugMug event gallery links (RMR-configured for MVP; extensible to any SmugMug-using club)
- MSR single-sign-on (coming — blocked on MotorsportReg credentials)

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
- **`ScoringSystem`** — named scoring presets owned by a league (e.g. "PCA Classic").
- **`Season`** — one per league-year, addressed by a `slug` unique within its league (defaults to `slugify(name)`; multiple seasons in the same year are allowed — each gets its own slug, e.g. a "2026 Summer Series" and a later "2026 Winter Series"). Its `scoringPolicy` is a **snapshot** copy of a `ScoringSystem` preset's policy, taken at creation time — never a live reference — so editing a preset later never reshapes a past season's standings.

### Multi-league browsing

- **`/leagues`** — directory of every `League` row on the deployment (name, active-season summary, event counts).
- **`/l/[league]`** — that league's home page (events list), **`/l/[league]/leaderboard`** (active/latest season) or **`/l/[league]/leaderboard/s/[seasonSlug]`** (a specific season), and **`/l/[league]/events/[slug]`** — all league-scoped, respecting that league's own `accessGate`.
- The **legacy, unprefixed routes** (`/`, `/leaderboard[/year]`, `/events/[slug]`) are unchanged and always serve `DEFAULT_LEAGUE_SLUG` — existing bookmarks and the production PCA deployment are unaffected.
- The site header shows a "Leagues" nav link only when the deployment hosts more than one league.

### CLIs

Create a new league (a fresh tenant — site branding, access gate, and a default scoring preset in one step):

```sh
pnpm --filter web league:create --slug rmsolo --name "Rocky Mountain Solo" \
  [--title <title>] [--description <text>] [--footer <text>] [--landing <text>] \
  [--gate required|optional|none] [--preset-name <name>] [--policy-file ./policy.json]
```

`--gate` defaults to `"required"` (same as the seeded `pca-rmr` league) — **explicitly pass `--gate optional` or `--gate none` for any new league**, since per-league membership isn't wired up yet (see "Operational note" below). A brand-new league has no `ScoringSystem` preset of its own, so `league:create` always creates one alongside the `League` row: `--policy-file` if given, else a PCA-shaped default (fixed drops, no PAX section, raw class metric, 2000ms cone penalty) — this is what `season:create`/ingest auto-create fall back to when no `--preset`/`--policy-file` is given.

Create a new season with:

```sh
pnpm --filter web season:create --league pca-rmr --name "2027 Season" --year 2027 --planned 6 \
  [--slug 2027-season] [--preset "PCA Classic" | --policy-file ./policy.json]
```

`--slug` defaults to `slugify(name)`. Multiple seasons per (league, year) are allowed as long as their slugs differ within that league — this is what makes a mid-year second series (e.g. a Winter Series alongside a Summer Series) addressable.

Ingest supports a `--league <slug>` flag on both pipelines (defaults to `DEFAULT_LEAGUE_SLUG` when omitted):

```sh
pnpm --filter web ingest --league rmsolo <path-to.axdb>
pnpm --filter web ingest:rmsolo --league rmsolo --file <pdf> --date YYYY-MM-DD [--name "Event name"]
pnpm --filter web ingest:rmsolo --league rmsolo   # no --file: scrapes the RMsolo results index instead
```

**ScoringPolicy v1** (the JSON shape snapshotted onto `Season.scoringPolicy`):

| Field | Values | Meaning |
|---|---|---|
| `drops` | `"fixed"` \| `"proportional"` | fixed: best-N-of-M scores count regardless of season progress (PCA). proportional: the drop count scales with events completed (RMsolo). |
| `paxSection` | boolean | Render a synthetic overall-PAX standings section, pinned first. |
| `classMetric` | `"raw"` \| `"pax"` | Rank class sections on best corrected time, or on PAX-adjusted time. |
| `conePenaltyMs` | number | Milliseconds added per cone struck (PCA convention: 2000). Threaded end-to-end into per-entry corrected-time math — a season configured with a different value scores its own events using that value. |

`League.footerText` renders verbatim in the site footer when set; a league with `footerText` left `null` falls back to the generic **"Powered by Launch Control"** string.

### Two-league local bring-up walkthrough

The exact commands to stand up a second league (RMsolo) alongside the default `pca-rmr` league in your local DB:

```sh
# 1. Create the RMsolo league. --gate defaults to optional; --gate required
#    is refused for any league created here — see "Operational note" below.
pnpm --filter web league:create --slug rmsolo --name "Rocky Mountain Solo"

# 2. Write a scoring policy for the season (proportional drops + PAX standings,
#    a common RMsolo-style preset) and create the season from it.
cat > /tmp/rmsolo-policy.json <<'EOF'
{"v":1,"drops":"proportional","paxSection":true,"classMetric":"pax","conePenaltyMs":2000}
EOF
pnpm --filter web season:create --league rmsolo --name "2026 Summer Series" --year 2026 \
  --planned 10 --policy-file /tmp/rmsolo-policy.json

# 3. Ingest RMsolo results into that league (scrapes the RMsolo results index;
#    pass --file/--date instead to ingest one PDF).
pnpm --filter web ingest:rmsolo --league rmsolo

# 4. Browse it.
pnpm --filter web dev
# open http://localhost:3000/leagues
```

**Operational note:** only the seeded default league (`pca-rmr`) may run with `accessGate: "required"` — per-login MSR membership is checked against the *default* league's org only (`isRmrMember` is computed at sign-in time, not per-league), so a non-default league would mis-gate on the wrong org's membership. This is enforced, not just documented: `league:create` refuses `--gate required` outright, and `league-config.ts`'s League-row-to-config resolver throws for any non-default league whose `accessGate` is `"required"` however it got there. Use `--gate optional` or `--gate none` (the default) for every non-default league until per-league membership ships (PR 3).

**`SESSION_SECRET` is required** whenever the *default* league's `accessGate` is `"required"` — that's the seeded `pca-rmr` config, so any deployment serving it (including this local walkthrough, since `pca-rmr` stays the default league) needs `SESSION_SECRET` set in `apps/web/.env`, or every gated page 500s. Generate one with `openssl rand -hex 32`.

### Driver stats filters

`/drivers/[id]` accepts query params to scope its stats: `?league=<slug>` (or `league=all` to combine leagues; default is the legacy single-league scope) crossed with a time scope — `?season=<seasonId>` for one season, `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a custom range, or no time param at all for all-time. Event/podium/points counts aggregate across leagues when `league=all`; progression and time-delta charts always render one series per league (never mixed on one axis).

The season leaderboard's **Avg** column is the driver's championship average points (total points ÷ counted scores, i.e. dropped scores excluded) — a quick read on scoring pace independent of how many events a driver has attended.

## Project status

M0–M1.12 shipped: ingest with PII redaction, styled leaderboards, GitHub Actions CI, per-driver progression at `/drivers/[id]`, SmugMug photo links, RMR season standings at `/leaderboard`, and ingest correctness pass. M2 (MSR OAuth) is blocked on credentials. See [docs/BUILD.md](docs/BUILD.md) for the full milestone history and [docs/PRD.md](docs/PRD.md) for requirements.

## License

Copyright (C) 2026 David Campbell and BJ Fulton.

Licensed under the [GNU General Public License v3.0 or later](LICENSE). This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the LICENSE file for details.
