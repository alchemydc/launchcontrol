# PCA Launch Control

A streamlined web platform for the Porsche Club of America Rocky Mountain Region. The MVP unifies member identity via MotorsportReg, auto-publishes 2026 AX/track event results from AxWare `.axdb` files, and centralizes community media links.

See the full spec in **[docs/PRD.md](docs/PRD.md)**.

## Repo layout

```
.
├── apps/
│   └── web/            Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Prisma
├── docs/               Product + technical docs (PRD lives here)
└── pnpm-workspace.yaml pnpm workspace config
```

Local-only (gitignored): `2026_season_data/` holds real AxWare `.axdb` exports with member PII for dev/smoke-testing. Tests run against the committed synthetic fixture at `apps/web/tests/fixtures/synthetic.axdb` — never real member data.

## Stack

Next.js · TypeScript · React · Tailwind · shadcn/ui · Prisma + SQLite · Vercel

## Develop

```sh
# from the repo root — installs all workspaces
pnpm install

# run the web app
pnpm --filter web dev

# ingest an AxWare .axdb into dev.db (relative paths resolve from your shell cwd)
pnpm --filter web ingest 2026_season_data/2026-04-25/2026-04-25-DB.axdb

# run the test suite (vitest; uses a throwaway apps/web/test.db)
pnpm --filter web test

# apply a Prisma migration / regenerate the client
pnpm --filter web exec prisma migrate deploy
pnpm --filter web exec prisma generate

# regenerate the synthetic test fixture
node apps/web/tests/fixtures/build-synthetic-axdb.mjs

# bulk-ingest every event folder under a tree (skips *Trailer Export*.axdb,
# prompts when multiple canonical candidates are present)
apps/web/scripts/ingest.sh 2026_season_data/

# drop all schema objects from the configured DB (local or Turso) without
# deleting the DB itself — handy for clean re-ingests on Turso without
# rotating credentials. Then re-apply migrations with migrate:turso.
pnpm --filter web wipe:db            # interactive
pnpm --filter web wipe:db -- --dry-run
```

The dev SQLite file lives at `apps/web/dev.db` and is gitignored.

### Environment variables

Local dev works out of the box — no Turso credentials needed. The env file lives under `apps/web/`, not the repo root. Copy `apps/web/.env.example` to `apps/web/.env` (or `.env.local`) and edit as needed:

| Variable | Local default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Local libSQL file path |
| `TURSO_DATABASE_URL` | _(blank)_ | Turso remote URL — set in Vercel for preview/prod |
| `TURSO_AUTH_TOKEN` | _(blank)_ | Turso auth token — set in Vercel for preview/prod |
| `SMUGMUG_API_KEY` | _(blank)_ | SmugMug API key. Optional — leave blank locally; the event "Photos ↗" link is hidden when unset. |
| `SMUGMUG_USER` | `rmrpca` | SmugMug account whose galleries are searched. Hard-coded to RMR PCA for MVP. |
| `SMUGMUG_DISCIPLINE_PATH` | `Autocross` | Discipline folder within the SmugMug account. |

If `TURSO_DATABASE_URL` is set, the app connects to Turso; otherwise it falls back to `DATABASE_URL` (local file). No Turso account or credentials are needed for local development.

SmugMug photo album links are surfaced on the home page event cards and on each event page when `SMUGMUG_API_KEY` is set. The lookup is fuzzy-matched by event name + date against the SmugMug folder tree — see PRD §M1.8 for the matching rules and the known RMR/PCA scoping limitations.

## Project status

Milestones tracked in [docs/PRD.md §3](docs/PRD.md). Public preview is live at **[launchcontrol.club](https://launchcontrol.club)** (Vercel + Turso libSQL). M0 through M1.10 shipped: ingest, last-name redaction, styled leaderboards, GitHub Actions CI, per-driver progression page at `/drivers/[id]`, SmugMug event photo links, RMR season leaderboard with multi-season nav, and an ingest correctness pass (batched writes, identity-hash driver dedupe, ghost-registration skip — see PRD §M1.10). M2 (MSR OAuth) remains blocked on credentials from MotorsportReg. M1.11 added backfill tooling: a bulk ingest script that handles multi-`.axdb` event folders (skipping Trailer Export snapshots), and a schema-only DB wipe utility for clean Turso re-ingests without rotating credentials.

## License

Copyright (C) 2026 David Campbell and BJ Fulton.

Licensed under the [GNU General Public License v3.0 or later](LICENSE). This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the LICENSE file for details.
