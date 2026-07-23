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

- **`League`** — one row per deployment: site branding (name, title, description, footer), the MSR access gate and org, and SmugMug lookup defaults. `DEFAULT_LEAGUE_SLUG` (env, default `pca-rmr`) is the only tenant-selecting env var — it names which `League` row this deployment serves. A fresh DB seeds the `pca-rmr` row via the League Foundation migration, reproducing the original production deployment byte-for-byte.
- **`ScoringSystem`** — named scoring presets owned by a league (e.g. "PCA Classic").
- **`Season`** — one per league-year. Its `scoringPolicy` is a **snapshot** copy of a `ScoringSystem` preset's policy, taken at creation time — never a live reference — so editing a preset later never reshapes a past season's standings.

Create a new season with:

```sh
pnpm --filter web season:create --league pca-rmr --name "2027 Season" --year 2027 --planned 6 \
  [--preset "PCA Classic" | --policy-file ./policy.json]
```

**ScoringPolicy v1** (the JSON shape snapshotted onto `Season.scoringPolicy`):

| Field | Values | Meaning |
|---|---|---|
| `drops` | `"fixed"` \| `"proportional"` | fixed: best-N-of-M scores count regardless of season progress (PCA). proportional: the drop count scales with events completed. |
| `paxSection` | boolean | Render a synthetic overall-PAX standings section, pinned first. |
| `classMetric` | `"raw"` \| `"pax"` | Rank class sections on best corrected time, or on PAX-adjusted time. |
| `conePenaltyMs` | number | Milliseconds added per cone struck (PCA convention: 2000). Per-entry scoring isn't wired to read this field yet, so a `Season` must set it equal to the app's shared cone-penalty constant — the app throws loudly at season-load time on a mismatch rather than silently scoring with the wrong value. |

`League.footerText` renders verbatim in the site footer when set; a league with `footerText` left `null` falls back to the generic **"Powered by Launch Control"** string.

## Project status

M0–M1.12 shipped: ingest with PII redaction, styled leaderboards, GitHub Actions CI, per-driver progression at `/drivers/[id]`, SmugMug photo links, RMR season standings at `/leaderboard`, and ingest correctness pass. M2 (MSR OAuth) is blocked on credentials. See [docs/BUILD.md](docs/BUILD.md) for the full milestone history and [docs/PRD.md](docs/PRD.md) for requirements.

## License

Copyright (C) 2026 David Campbell and BJ Fulton.

Licensed under the [GNU General Public License v3.0 or later](LICENSE). This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the LICENSE file for details.
