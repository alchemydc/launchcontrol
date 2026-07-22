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

## Environment variables

| Variable | Local default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Local libSQL file path |
| `TURSO_DATABASE_URL` | _(blank)_ | Turso remote URL — set in Vercel for preview/prod |
| `TURSO_AUTH_TOKEN` | _(blank)_ | Turso auth token — set in Vercel for preview/prod |
| `SMUGMUG_API_KEY` | _(blank)_ | SmugMug API key. Optional — leave blank locally; the event "Photos ↗" link is hidden when unset. |
| `SMUGMUG_USER` | `rmrpca` | SmugMug account whose galleries are searched. Hard-coded to RMR PCA for MVP. |
| `SMUGMUG_DISCIPLINE_PATH` | `Autocross` | Discipline folder within the SmugMug account. |

## Multi-club configuration

Tenant identity, branding, and access policy are env-driven (`src/lib/club-config.ts`), so one codebase can serve other clubs without a fork. Defaults reproduce the PCA RMR deployment byte-for-byte.

| Variable | Default | Purpose |
|---|---|---|
| `SITE_TITLE` | `Launch Control · PCA RMR` | Site title/branding |
| `SITE_DESCRIPTION` | _(RMR copy)_ | Meta description |
| `FOOTER_TEXT` | _(RMR copy)_ | Footer text |
| `LANDING_DESCRIPTION` | _(RMR copy)_ | Landing page copy |
| `ACCESS_GATE` | `required` | `required` (session + org membership gate results, PCA posture) \| `optional` (public results, login offered) \| `none` (public, no login UI) |
| `NAME_DISPLAY` | `initial` | `initial` ("First L.", PCA privacy posture) \| `full` ("First Last", where `Driver.lastName` is stored) |
| `MSR_ORG_ID` | _(blank)_ | MSR org UUID for membership display/gating. `MSR_RMR_ORG_ID` still honored as a legacy alias. |

### RMsolo deployment

Some clubs publish results as [RMsolo](http://rm-solo.sourceforge.net/) PDFs instead of AxWare `.axdb` exports. A second ingest pipeline (`src/lib/rmsolo-{index,parse,ingest}.ts`) scrapes a club's RMsolo results page and parses its Full-results PDFs.

Requires [poppler](https://poppler.freedesktop.org/) for `pdftotext`: `brew install poppler` (macOS) or `apt install poppler-utils` (Debian/Ubuntu).

```sh
# Scrape the current season's results page and ingest every new event
pnpm --filter web ingest:rmsolo

# Ingest a single PDF already on disk
pnpm --filter web ingest:rmsolo --file event.pdf --date 2026-04-12 [--name "April Points #2"]
```

Pro Solo events are auto-skipped (unsupported results format, deferred alongside the Winter Series). Entries with no printed driver name ingest as anonymous drivers named "Unknown #\<car\>" — these are real scoring entries in the official results. Classes whose printed Best is PAX-indexed (M/N/S/P/X run-groups) ingest with the best time computed from runs (`bestCommittedRunNumber` left null); results remain correct.

For a self-hosted deployment, build once and run the server, then poll for new results on a schedule:

```sh
pnpm --filter web build && pnpm --filter web start
```

```
15 6 * * * cd /path/to/launchcontrol && pnpm --filter web ingest:rmsolo >> /var/log/rmsolo-ingest.log 2>&1
```

## Project status

M0–M1.12 shipped: ingest with PII redaction, styled leaderboards, GitHub Actions CI, per-driver progression at `/drivers/[id]`, SmugMug photo links, RMR season standings at `/leaderboard`, and ingest correctness pass. M2 (MSR OAuth) is blocked on credentials. See [docs/BUILD.md](docs/BUILD.md) for the full milestone history and [docs/PRD.md](docs/PRD.md) for requirements.

## License

Copyright (C) 2026 David Campbell and BJ Fulton.

Licensed under the [GNU General Public License v3.0 or later](LICENSE). This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the LICENSE file for details.
