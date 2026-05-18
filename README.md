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
```

The dev SQLite file lives at `apps/web/dev.db` and is gitignored.

## Project status

Milestones tracked in [docs/PRD.md §3](docs/PRD.md). M0 (scaffold) and M1 (ingest + static leaderboard) are done; M2 (MSR OAuth) is blocked on credentials from MotorsportReg.
