# RMsolo local setup and ingest

This runbook creates a Rocky Mountain Solo league in a freshly migrated local
database and ingests the currently published championship results.

Database migrations seed only the built-in `pca-rmr` league and its PCA
ruleset. RMsolo is an additional league and must be created explicitly.

## Prerequisite: `pdftotext`

RMsolo publishes results as PDFs. Launch Control uses the `pdftotext`
executable from Poppler to extract their text; this is a system package, not a
Node dependency.

Install it on Debian or Ubuntu:

```sh
sudo apt-get install poppler-utils
```

Install it on macOS with Homebrew:

```sh
brew install poppler
```

Confirm it is available on `PATH`:

```sh
pdftotext -v
```

The project Docker image already installs `poppler-utils`.

## Create the league and season

Run these commands from the repository root:

```sh
pnpm --filter web league:create \
  --slug rmsolo \
  --name "Rocky Mountain Solo" \
  --gate optional \
  --preset-name "RMsolo Championship" \
  --policy-file apps/web/config/rmsolo-championship-policy.json

pnpm --filter web season:create \
  --league rmsolo \
  --name "2026 Championship Series" \
  --year 2026 \
  --planned 10 \
  --minimum-events 6 \
  --preset "RMsolo Championship"
```

The checked-in policy uses proportional drops, counts the best six results
after a ten-event season, enables the overall PAX section, and applies a
two-second cone penalty. The season's six-event qualification threshold is
separate from the ruleset's four dropped scores.

League creation also seeds the complete built-in 2026 RMsolo PAX table onto
the new ruleset. The season points at that ruleset by live reference.

## Ingest the current championship results

```sh
pnpm --filter web ingest:rmsolo --league rmsolo
```

With no `--file` argument, this command reads the folder currently selected on
the [RMsolo results page](https://www.rmsolo.org/results/), downloads each
Full PDF, and ingests it into the specified league. Unsupported ProSolo
results and rows without a Full PDF are skipped. A failure in one event is
reported without preventing later events from being attempted.

The command is idempotent. Re-run it whenever RMsolo publishes another event;
PDFs already ingested into this league are skipped by source hash.

To ingest one downloaded Full PDF instead:

```sh
pnpm --filter web ingest:rmsolo --league rmsolo \
  --file path/to/results.pdf \
  --date YYYY-MM-DD \
  --name "Optional event name"
```

The date is required because the Full PDF itself does not contain the event
date.

## Verify locally

Start the app:

```sh
pnpm --filter web dev
```

Open:

- `http://localhost:3000/leagues`
- `http://localhost:3000/l/rmsolo`
- `http://localhost:3000/l/rmsolo/leaderboard`

## About the Launch Control API

`POST /api/admin/leagues/[slug]/ingest-now` is the authenticated internal
route used by the league admin dashboard's **Ingest now** button. It runs the
same RMsolo scrape loop as the CLI. It is not an unauthenticated operator or
bootstrap API: the caller must already have league-admin access, the deployment
must set `INGEST_NOW_ENABLED=1`, and `pdftotext` must be installed.

For a fresh local database, use the `league:create`, `season:create`, and
`ingest:rmsolo` CLIs above.

## Current limitations

- The index scraper follows only the results folder selected by default on
  rmsolo.org; it does not select historical or Winter Series folders.
- ProSolo PDFs use a different results format and are intentionally skipped.
- The built-in PAX table is the 2026 table. Review and update the ruleset
  before using it for another season year.
