# PCA Launch Control — MVP Product & Technical Spec

**Project:** PCA RMR community web platform (MVP)
**Stack:** Next.js (App Router) · TypeScript · React · Tailwind · shadcn/ui · Prisma + SQLite · Vercel
**Core integrations:** MotorsportReg (MSR) OAuth 1.0a · AxWare `.axdb` ingestion

### Glossary

- **MSR** — [MotorsportReg.com](https://www.motorsportreg.com), the registration and identity system used by PCA regions (including RMR). Source of truth for member identity.
- **AxWare** — desktop timing software used at-event by RMR. Emits a SQLite database file with the extension `.axdb` after each event. Real season exports live in the gitignored `2026_season_data/` directory locally; they contain member PII and must never be committed or used as CI fixtures.
- **PAX** — class index multiplier applied to raw time to produce a normalized "PAX time" for cross-class comparison.
- **Run group** — the on-event run order grouping (e.g., morning/afternoon). Tracked per-event by AxWare.

---

## Part 1 · Product Requirements

### 1.1 Vision

A streamlined, high-performance web platform for the Porsche Club of America Rocky Mountain Region. The MVP focuses on Autocross (AX) and track events by (a) unifying member identity via MSR, (b) auto-publishing 2026 event results from AxWare `.axdb` files, and (c) centralizing community media links.

### 1.2 Personas

- **RMR Driver / Competitor** — wants frictionless MSR login, a clean mobile-responsive results dashboard (raw / PAX / class), and a way to view or share event media.
- **RMR Admin / Timing Chief** — wants a dead-simple way to publish a post-event `.axdb` so leaderboards appear immediately.

### 1.3 MVP Feature Scope

#### 1.3.1 Auth & Identity (MSR)

- **MSR OAuth 1.0a login** — authenticate users against their MSR profile (see §2.2 for endpoints).
- **Signed session cookie** — HttpOnly, SameSite=Lax, signed (`iron-session` or `jose`-signed JWT), keyed on the MSR user UID returned by `/rest/me`.
- **Dynamic public calendar** — `/calendar` fetches the RMR org's MSR event calendar server-side and caches it for 5 minutes.

#### 1.3.2 AxWare `.axdb` ingestion

- **PII redaction at ingest** — driver last names from AxWare are reduced to a single uppercase initial + period (e.g. `Kennedy` → `K.`) **before** any row reaches the app DB. The full last name is never persisted by this app. The on-event AxWare DB still holds the unredacted source, but our deploy DB and any leaderboard rendering only ever expose `First L.`. See §2.4 schema (`Driver.lastInitial`) and §2.6 mapping rules.
- **Local ingest CLI (M1)** — `pnpm ingest <path-to-axdb>` reads the source SQLite read-only, normalizes (with redaction) into the app DB. Developers point this at their gitignored `2026_season_data/*/.axdb` files for local smoke testing; CI/tests use a synthetic fixture (see DoD).
- **Admin upload (M4)** — `POST /api/admin/ingest` (multipart, admin-only) reuses the same ingest logic.
- **Dynamic leaderboards** — `/events/[slug]` renders sortable, filterable tables: overall raw, PAX/indexed, class standings; per-driver run details (cones, DNF/RRN dispositions, splits). Driver column shows `First L.` only.

#### 1.3.3 Media aggregation

- **SmugMug embeds** — event pages auto-embed the gallery for the event date (rule TBD — see open questions).
- **Driver video links** — authenticated users submit YouTube/Vimeo links tied to event + driver + run group + car class.

---

## Part 2 · Architecture & Data

### 2.1 System Context

```
[ Browser (mobile / desktop) ]
              │  HTTPS
              ▼
[ Vercel · Next.js (App Router) ]
      ├── Route Handlers (app/api/*)
      ├── Server Components (SSR/ISR)
      └── Prisma client
              │
              ▼
        [ SQLite app DB ]
              ▲
              │ batched upsert
[ Ingest CLI (local) or /api/admin/ingest ]
              │ readonly
              ▼
   [ Uploaded AxWare .axdb (SQLite) ]

External:
[ Next.js ] ──OAuth 1.0a──▶ motorsportreg.com (request / authorize / access)
[ Next.js ] ──REST──────▶ api.motorsportreg.com/rest/* (with stored access token)
```

The "SQLite app DB" above is **SQLite locally** and **Turso (libSQL) in preview/prod** — same SQL dialect, swapped at the Prisma driver-adapter layer. See §2.7 for rationale. No Docker, Nginx, or Tailscale in the MVP. See the post-MVP appendix for hardening options.

### 2.2 MSR OAuth 1.0a (verified)

Verified against MSR's developer page at `api.motorsportreg.com` (May 2026).

**Three-legged flow, HMAC-SHA1 signing (RFC 5849):**

| Step                 | Method/URL                                                                            |
|----------------------|---------------------------------------------------------------------------------------|
| 1. Request token     | `POST https://api.motorsportreg.com/rest/tokens/request`                              |
| 2. User authorize    | Redirect to `https://www.motorsportreg.com/index.cfm/event/oauth?oauth_token={token}` |
| 3. Access token      | `POST https://api.motorsportreg.com/rest/tokens/access`                               |
| 4. Authenticated API | `Authorization: OAuth …` header (+ `X-Organization-Id` for org-scoped reads)          |

**MVP endpoints consumed:**

- `GET /rest/me` — user profile + org memberships (drives login + `/me` page).
- `GET /rest/calendars/organization/{org_id}` — RMR event calendar (drives `/calendar`).

**Library:** `oauth-1.0a` (npm) + Node `crypto` for HMAC-SHA1. Avoid heavyweight passport plugins; the flow is small enough to implement directly inside Route Handlers.

**Credentials:** request via MSR's [REST API integration page](https://info.motorsportreg.com/rest-api-integration). Requires admin access on the PCA RMR MSR organization. **This is the single external blocker for M2.** See open questions for owner.

### 2.3 AxWare source schema (observed)

Observed by running `.schema` and sample `SELECT`s against the gitignored `2026_season_data/*/*.axdb` files during initial spike. Both files share the same schema.

```sql
events(id, event_name, event_date, num_runs, mirrored, unique_numbers,
       org_name, timing_mode, typical_time, web_active, run_timestamp)

classes(id, class_name, paxed_class, pax, run_timestamp)
-- pax: float multiplier. class_name examples seen: C1..C5, CS, TO

drivers(id, last_name, first_name, number, class_id, paxmult_id,
        car_model, car_color, member_num, sponsor, tire, email,
        cellphone, member, registered, icon_color)
-- class_id   = class entered under (display)
-- paxmult_id = class used for the PAX index calculation (sometimes differs)

registrations(driver_id, event_id, bestcommittedrun_id, bestcommittedrun_no,
              bestpendingrun_id, run_timestamp)

runs(id, event_id, driver_id, start_at, finish_at, start_tick, finish_tick,
     cones, disposition, status)
-- raw_time_ms = finish_tick - start_tick  (millisecond ticks)
-- disposition: '' (clean), 'DNF', 'RRN' (re-run)
-- status: 3 = committed (only value observed)
```

Each `.axdb` exported from AxWare so far contains a **single event** (id=1) with ~70-80 drivers and ~600-650 runs.

### 2.4 Target app schema (Prisma + SQLite)

Tighten the normalized schema to match what the MVP actually needs. Times are integer milliseconds throughout to avoid float drift.

```prisma
model Event {
  id           Int      @id @default(autoincrement())
  msrEventId   String?  @unique           // populated when matched to MSR calendar
  slug         String   @unique           // e.g. "2026-04-25-blooming-cones"
  name         String
  date         DateTime
  location     String?
  axdbSha256   String?                    // dedupe re-ingests of the same .axdb
  createdAt    DateTime @default(now())
  entries      Entry[]
  videos       Video[]
}

model Driver {
  id          Int      @id @default(autoincrement())
  msrUid      String?  @unique
  firstName   String
  lastInitial String                       // single uppercase letter + period, e.g. "K." — never the full last name; enforced at ingest (§2.6)
  memberNum   String?  @unique
  entries     Entry[]
  videos      Video[]
}

model CarClass {
  id          Int      @id @default(autoincrement())
  code        String   @unique            // 'C1', 'CS', 'TO', ...
  paxIndex    Decimal  @default(1.0000)
  entries     Entry[]
}

model Entry {
  id            Int       @id @default(autoincrement())
  eventId       Int
  driverId      Int
  classId       Int                       // class entered (display)
  paxClassId    Int                       // class used for PAX calc
  carNumber     String
  carDescription String?
  event         Event     @relation(fields: [eventId],    references: [id], onDelete: Cascade)
  driver        Driver    @relation(fields: [driverId],   references: [id], onDelete: Cascade)
  class         CarClass  @relation("EnteredClass",    fields: [classId],    references: [id])
  paxClass      CarClass  @relation("PaxClass",        fields: [paxClassId], references: [id])
  runs          Run[]

  // No @@unique on (eventId, driverId): a person can enter the same event
  // multiple times via co-drives or multi-class entries.
  @@index([eventId])
  @@index([driverId])
}

enum RunDisposition { CLEAN  DNF  RRN }

model Run {
  id           Int             @id @default(autoincrement())
  entryId      Int
  runNumber    Int
  rawTimeMs    Int?                       // null if DNF/DNS
  cones        Int             @default(0)
  disposition  RunDisposition  @default(CLEAN)
  entry        Entry           @relation(fields: [entryId], references: [id], onDelete: Cascade)
  @@index([entryId])
}

model Video {
  id          Int      @id @default(autoincrement())
  eventId     Int
  driverId    Int
  url         String
  runGroup    String?
  carClass    String?
  description String?
  createdAt   DateTime @default(now())
  event       Event    @relation(fields: [eventId],  references: [id], onDelete: Cascade)
  driver      Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)
}
```

Derived values (computed, not stored):

- `corrected_time_ms = raw_time_ms + cones * CONE_PENALTY_MS` where `CONE_PENALTY_MS = 2000` (PCA AX standard; lives as a constant in code until a region overrides it).
- `pax_time_ms = corrected_time_ms * paxClass.paxIndex`.

### 2.5 UI components (shadcn/ui)

Components are copied into `components/ui/` — not pulled as a versioned dependency — so the design system stays editable in-repo. Built on Radix primitives + Tailwind, matching the rest of the stack.

| Surface                              | Components used                                            |
|--------------------------------------|------------------------------------------------------------|
| `/events/[slug]` leaderboard         | `data-table` (TanStack Table) · `badge` · `card` · `tabs`  |
| `/calendar`                          | `card` · `badge` · `skeleton`                              |
| `/login`, `/me`                      | `button` · `card` · `avatar`                               |
| `/admin/ingest` upload form          | `form` · `input` · `button` · `dialog` · `toast` (`sonner`)|
| Video submission form                | `form` · `input` · `select` · `button` · `toast`           |

Dark mode is in scope for M0 (Tailwind `class` strategy + a small theme toggle).

### 2.6 Ingestion strategy

Library: **`better-sqlite3`** (synchronous, fast, no async overhead). It builds natively on macOS/Linux dev machines.

- **M1 (local CLI):** `pnpm ingest <path-to-axdb>` opens the source with `new Database(path, { readonly: true })`, reads `events` / `classes` / `drivers` / `registrations` / `runs`, and upserts into Prisma inside a single transaction. Idempotent on re-run (keyed by `(eventId, driverId)` and `(entryId, runNumber)`).
- **M4 (admin upload):** `POST /api/admin/ingest` accepts a multipart `.axdb`, writes it to a tmp file, and runs the same code path. **Vercel constraint:** the function must use the Node.js runtime (not Edge) and may need a higher memory tier; `better-sqlite3` ships native bindings that require Vercel's Node 20 runtime. If function size/cold-starts become an issue, fall back to a queue + background worker (post-MVP).

Mapping rules:

| AxWare source                              | App table / field                                            |
|--------------------------------------------|--------------------------------------------------------------|
| `events.event_name`, `event_date`          | `Event.name`, `Event.date`                                   |
| `classes.class_name`, `classes.pax`        | `CarClass.code`, `CarClass.paxIndex` (upsert by `code`)      |
| `drivers.first_name`                       | `Driver.firstName` (verbatim)                                |
| `drivers.last_name`                        | `Driver.lastInitial` = `last_name.trim()[0].toUpperCase() + '.'` — **full last name is never persisted** |
| `drivers.member_num`                       | `Driver.memberNum` (used as the upsert key; matches across events) |
| `registrations`                            | `Entry` (one row per driver-event)                           |
| `runs.finish_tick - runs.start_tick`       | `Run.rawTimeMs` (null when disposition='DNF' and no time)    |
| `runs.cones`                               | `Run.cones`                                                  |
| `runs.disposition`                         | `Run.disposition` (`''→CLEAN`, `'DNF'→DNF`, `'RRN'→RRN`)     |

Drivers without a `member_num` cannot be reliably deduplicated under redaction (two `John K.` entries are indistinguishable), so the ingest creates a fresh `Driver` row for each name+event in that case. Acceptable for MVP; revisit if it produces visible duplicates on a real-event leaderboard.

### 2.7 Database hosting — local SQLite, Turso (libSQL) in preview/prod

The original M0 plan put SQLite directly on the host. That works locally but **blocks Vercel deploys**: Vercel's serverless functions have an ephemeral filesystem with no shared state between invocations, so a single-writer SQLite file cannot be the production DB. This was discovered at the first attempted preview deploy after M1.

**Decision: keep SQLite locally; use Turso (libSQL) for preview + production.** Turso is a hosted, SQLite-compatible (libSQL) database with an HTTP wire protocol designed for serverless. The decision was made over the candidates below.

| Option              | Why considered                                  | Why not chosen for MVP                                                                                  |
|---------------------|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| **Turso (libSQL)**  | API key already procured; SQLite-compatible     | **Chosen.** See below.                                                                                  |
| Supabase Postgres   | Native Decimal/enum, broad feature set          | Free tier pauses inactive DBs; Supavisor pool URL config is a known foot-gun; Docker for local parity   |
| Neon serverless PG  | Excellent serverless latency; CI branching      | Best-in-class but requires full Postgres migration; benefit not worth the time at MVP scale             |
| Vercel Postgres     | Vercel-integrated provisioning UI               | It's Neon underneath; adds a layer of indirection with no technical gain                                |
| Cloudflare D1       | SQLite-shaped; great free tier                  | Workers-only runtime; incompatible with Vercel Node functions                                           |

**Why Turso for this MVP:**

- **Smallest migration:** the existing schema already targets `provider = "sqlite"` and we're already on the Prisma 7 driver-adapter pattern (`@prisma/adapter-better-sqlite3`). Swap to `@prisma/adapter-libsql` + a different `DATABASE_URL`. No schema model changes; `Decimal` (paxIndex) and the `RunDisposition` enum are emulated transparently by Prisma over libSQL — paxIndex stored as REAL is fine for the multiplier math we do, and the enum stored as TEXT is fine for filters.
- **Local-dev unchanged:** `file:./dev.db` for local, Turso remote URL in `.env.preview` / Vercel env. Same driver adapter both sides; no Docker, no daemon.
- **Latency:** Turso's HTTP protocol is stateless per request (no pooler needed). ~10–30ms added per query from a warm Vercel function — imperceptible for read-heavy public leaderboards at our scale.
- **Free tier:** 9 GB storage / 1B row-reads per month. We will never approach this.

**When we'd revisit:** if we ever need native Postgres features (full-text search via `tsvector`, JSONB querying, PostGIS), or if we want per-PR DB branching wired into CI. Neither is on the MVP roadmap.

**Local-only secrets:** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` live in Vercel env vars (preview + prod) and a developer's `.env.local` for those who want to point local dev at Turso. The default local dev path stays `file:./dev.db`.

---

## Part 3 · Build Plan (Milestones)

**Status (2026-05-21):** M0 ✓ · M1 ✓ · M1.5a ✓ · M1.5b ✓ · M1.6 ✓ · M1.7 ✓ · M1.8 ✓ — public preview is live at [launchcontrol.club](https://launchcontrol.club) (Vercel + Turso libSQL), with last-name redaction, racing-red styled UI, GitHub Actions CI (lint/typecheck/test/build on every PR), a per-driver progression page (`/drivers/[id]`) charting raw/PAX/best-of progression and time-delta vs. event leader across the season, and SmugMug photo album links surfaced on home + event pages. **Next up:** M1.9 — RMR season leaderboard (multi-season nav; M2 MSR OAuth remains blocked pending credentials requested 2026-05-18).

### M0 — Scaffold ✓ (done 2026-05-18)

- `pnpm create next-app` with TypeScript, App Router, Tailwind, ESLint.
- `pnpm dlx shadcn@latest init` (Neutral base, CSS variables, `@/*` alias); preinstall the components M1 will need (`button`, `table`, `card`, `badge`, `input`, `label`).
- Add Prisma + SQLite + `better-sqlite3`; check `prisma/schema.prisma` and an initial migration into the repo.
- Link the repo to Vercel; verify preview deploys on PR.
- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`.
- `2026_season_data/` is **gitignored** (member PII); developers keep `.axdb` files there locally for smoke testing.
- Build a small **synthetic** `.axdb` for CI/test fixtures and commit it under `apps/web/tests/fixtures/` (see DoD for asserted counts).

**Not yet done in M0:** Vercel project link (requires interactive `vercel login` / GitHub remote) — deferred to deployment session.

### M1 — Static leaderboard ✓ (done 2026-05-18)

- `src/lib/ingest.ts` — reusable ingest module (read-only `better-sqlite3` against AxWare source, normalize into Prisma in a single transaction, idempotent via `Event.axdbSha256`).
- `scripts/ingest.ts` — thin CLI; wired as `pnpm --filter web ingest <path-to-axdb>` (resolves the path against `$INIT_CWD` so relative paths work from the repo root).
- Vitest integration tests against the synthetic fixture (`pnpm --filter web test`).
- `/` lists events from the DB; `/events/[slug]` renders a sortable, class-filterable leaderboard (Raw / PAX / per-run badges) using shadcn `Table` + `@tanstack/react-table` state.
- Real-event smoke: both `2026_season_data/*/.axdb` files ingest cleanly into local dev.db.
- **Schema correction during M1:** dropped `@@unique([eventId, driverId])` on `Entry` — autocross allows co-drives and multi-class entries (same person ↦ multiple entries at one event). Migration: `20260518230343_entry_allow_multi`.
Note that static leaderboard is *not* yet using tailwind styling or shadcn table, icons, etc.

### M1.5a — PII redaction + standalone smoke test ✓ (done 2026-05-19)

Land redaction on its own first so the change is reversible and the new assertions can stabilize before we also move the DB underneath them.

- **Schema:** rename `Driver.lastName` → `Driver.lastInitial` (`String`). `Driver.memberNum @unique` is already on disk in migration `20260518224456_driver_member_num_unique`; PRD §2.4 reflects it. Migration name: `entry_redact_last_initial`.
- **Ingest:** in `src/lib/ingest.ts`, introduce a `redactLastName(name)` helper: trim, take first char, uppercase, append `.`; blank/whitespace input → `?.`. Use it in the driver upsert path. Stop reading or persisting full last names.
- **Display:** `src/lib/leaderboard.ts` — update `EntryWithRelations.driver` type and the `driverName` template literal to `${firstName} ${lastInitial}`. No changes to `LeaderboardTable` itself.
- **Tests:** the synthetic `.axdb` does **not** change — it represents the unredacted AxWare source, which is what we receive in real life. What changes is what the post-ingest test DB looks like. Add two assertions to `tests/ingest.test.ts`:
  - every `Driver.lastInitial` matches `/^[A-Z?]\.$/`,
  - a regex sweep over all `Driver` rows confirms no fixture last name (`Ada`, `Brook`, `Chen`, `Diaz`, `Eckhart`) appears in any column beyond its first character.
- **Smoke test:** ingest both gitignored `2026_season_data/*/.axdb` files into local `dev.db`, run `pnpm dev`, and visually confirm the leaderboard shows `First L.` for every driver.

### M1.5b — Turso migration + first Vercel preview deploy at `launchcontrol.club` ✓ (done 2026-05-19)

- **DB driver swap ✓:** replaced `@prisma/adapter-better-sqlite3` with `@prisma/adapter-libsql`. The Prisma singleton in `src/lib/prisma.ts` instantiates from `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` when set, else falls back to local `file:./dev.db` via libSQL. `pnpm ingest` keeps working locally with no CLI changes.
- **Migrations ✓:** local `prisma migrate dev` flow preserved; `prisma migrate deploy` runs against Turso on deploy. Added a `postinstall: prisma generate` in `apps/web/package.json` so Vercel's build picks up a fresh client.
- **Deploy ✓:** repo linked to Vercel, env vars (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `DATABASE_URL`) set in Vercel preview + prod. Initial deploy hit two issues — both fixed in-flight:
  - `@libsql/client` import path / runtime mismatch on Vercel Node 20 — resolved by importing from `@libsql/client/web`.
  - Single-statement Turso HTTP transactions need looser timeouts than the local file path — relaxed Prisma transaction defaults.
- **Custom domain ✓:** `launchcontrol.club` (registered 2026-05-19) attached to the Vercel project; production serves `launchcontrol.club` + `www.launchcontrol.club`, previews on `*.vercel.app`.

### M1.65 — CI ✓ (done 2026-05-19)

GitHub Actions workflow at `.github/workflows/ci.yml` runs on every PR and `main` push: `pnpm install --frozen-lockfile`, `prisma generate`, lint, typecheck, vitest, and `next build`. Node 22 + pnpm via `pnpm/action-setup`. Concurrency group cancels superseded runs on the same ref. Vitest is invoked with `execFileSync` for `prisma migrate deploy` to avoid shell injection (Copilot review note on the first CI PR).

### M1.6 — Initial styling pass ✓ (done 2026-05-19)

Browser inspection ruled out the suspected CSS pipeline problem — Tailwind v4 + shadcn variables were rendering correctly. The real issue was that the palette was pure zero-chroma neutrals (`oklch(... 0 0)`), so the styled app read as raw HTML. Scope expanded from "visual fix" to a full first-pass styling.

What landed:
- **Palette:** racing-red primary (`oklch(0.55 0.22 25)` light / `oklch(0.62 0.20 25)` dark) on warm-slate surfaces; matching ring, destructive, accent, and a 5-stop chart spectrum (red → orange → amber → slate → graphite). Removed the stale `@import "shadcn/tailwind.css"` line.
- **System-controlled dark mode:** added `@media (prefers-color-scheme: dark) :root { ... }` alongside the existing `.dark` class variant, so the OS pref controls theme without JS, no FOUC, no `next-themes` dependency. The `dark:` Tailwind variant remains usable for any future class-based override.
- **Site chrome (`app/layout.tsx`):** sticky top header with the wordmark "Launch Control" linking to `/` and a muted `RMR · 2026 Season` kicker; footer with PCA RMR attribution. Page metadata updated from "Create Next App" to a real title template and description.
- **Home page:** kicker + accent strip hero, event list wrapped in a soft tinted panel, card hover lifts to `border-primary/40` + `group-hover:text-primary`.
- **Leaderboard:** added a rank column derived from the current sort (top-1 in `text-primary font-bold`, top-3 semibold, rest muted) with a subtle `bg-primary/5` accent on the leader row; added a `success` Badge variant for clean runs so DNF/RRN (now red, matching destructive) stand visually apart.

No UI tests added — the change is purely presentational. Existing `tests/ingest.test.ts` (6 tests) plus `tsc --noEmit` continue to cover the regression surface. Visual regression / a11y testing can come later if the surface grows.

Deferred from the original M1.6 plan: README screenshot smoke check (defer to M1.5b when there's a Vercel preview URL to link).

### M1.7 — Driver progression page ✓ (done 2026-05-20)

A first cut of the "track performance against leaders/rivals visually" post-MVP idea landed early because the data was already in-DB and the leaderboard alone wasn't telling a season story.

- **Route:** `/drivers/[id]` — server-rendered (`force-dynamic`), shows the driver's per-event history table plus two Recharts panels.
- **Lib:** `src/lib/driver-history.ts` — assembles a driver's events chronologically with raw best, PAX best, and the event-leader PAX time for delta computation.
- **Charts:**
  - `ProgressionChart` — raw best vs. PAX best vs. running best-of-season per driver across events.
  - `TimeDeltaChart` — driver's PAX best minus the event-leader PAX best (always ≥ 0; the leader sits at the x-axis). Y-axis clamped to 0 so the leader visually anchors the chart (Copilot review #2). Tooltip copy reads "vs. event leader" (Copilot review #3).
- **Dark mode:** chart palette pulled from the racing-red CSS variable set so both light and dark modes read correctly (initial deploy had washed-out chart colors in dark mode — fixed before the merge).
- **Linking:** leaderboard driver names link to `/drivers/[id]`.

**Deferred — test coverage gap (follow-up task, schedule alongside or before M1.9):** `src/lib/driver-history.ts` ships real computation (CLEAN-filter + cone correction in `bestPaxMsForEntry`, per-event ranking, event-leader PAX delta) but has no tests. Add vitest coverage in `apps/web/tests/driver-history.test.ts` for:
- `bestPaxMsForEntry()` — CLEAN runs only, cone penalty applied, PAX multiplier applied; returns `null` when no CLEAN runs exist.
- `buildDriverHistory()` — events appear in chronological order; per-event position, raw best, PAX best, leader PAX time, and running best-of-season are correct against a deterministic fixture; driver absent from an event is omitted (not zero-filled).
- Edge cases: driver with only DNFs at an event, driver tied with event leader (delta = 0), driver who never set a clean time across the season.

Component-level tests for `ProgressionChart` / `TimeDeltaChart` are out of scope — the M1.9 plan keeps "visual regression / a11y testing for later if the surface grows."

### M1.8 — SmugMug event photo links ✓ (done 2026-05-20)

Unplanned feature: surface RMR's existing SmugMug event galleries directly on event listings, since members were already linking to them by hand.

- **Module:** `apps/web/src/lib/smugmug.ts` — `findSmugmugEventFolder()` exported and consumed by `app/page.tsx` (home event cards) and `app/events/[slug]/page.tsx` (event header). Renders a "Photos ↗" affordance when a match is found; silent when not.
- **Matching:** hybrid score = `0.6 * tokenScore + 0.4 * dateScore`, threshold 0.6. Token side strips stopwords (`autocross`, `ax`, `axn`, `round`, articles) and uses bidirectional overlap so photographers' abbreviated folder names still match. Date side reads ISO 8601 prefix from folder name (e.g. `2026-04-25-Blooming-Cones`), falls back to SmugMug's `dateAdded`, scores within a 30-day window. No admin slug/override — fully algorithmic.
- **Caching:** two-tier `unstable_cache` — year-folder lookup 1 week TTL, event-folder list 1 hour TTL. Cache keys include `SMUGMUG_USER` + `SMUGMUG_DISCIPLINE` so changing org/discipline invalidates correctly (b140abe).
- **Env vars (added to `.env.example`):** `SMUGMUG_API_KEY` (required; warning logged if missing), `SMUGMUG_USER` (default `"rmrpca"`), `SMUGMUG_DISCIPLINE_PATH` (default `"Autocross"`).
- **Tests:** `apps/web/tests/smugmug.test.ts` — token overlap, stopwords, date tiebreaking, bidirectional matching, threshold edge cases.
- **Known limitations — RMR/PCA-specific, revisit post-MVP:**
  - Single-tenant by design: one `SMUGMUG_USER` + one `SMUGMUG_DISCIPLINE_PATH` per deploy. No per-event or per-region overrides.
  - Defaults hard-code `rmrpca` / `Autocross`. Other regions or other disciplines (track, rallycross, social) would require separate deploys today.
  - Matching is best-effort; mismatches are silent (no admin UI to confirm or override a fuzzy match).
  - Post-MVP generalization sketch: per-event SmugMug folder override (admin-set), or per-region config keyed off a future `Region` entity. See open question #9 and the post-MVP feature list.

### M1.9 — RMR season leaderboard (target: 2 sessions; next up while M2 is blocked)

A season-long points standings page across each car class, plus the navigation shape to support both the current 2026 season and a historical 2025 season (data backfill in scope).

**Scoring rules (RMR PCA 2026 — region-specific):**
- 1000 points per event to the fastest driver in each class.
- All other drivers in the class earn `points = round(1000 * fastest_class_time / driver_best_time)`. Ties for fastest → all tied drivers earn 1000.
- "Best time" = best CLEAN run, corrected for cones (`raw_time_ms + cones * CONE_PENALTY_MS`). **No PAX adjustment** — drivers are already class-scoped, so PAX is irrelevant for intra-class comparison.
- Season is 7 events. **Best 4 scores per driver count** toward the season total; the other 3 are dropped (but still rendered, visually muted, for transparency).

**Single season class per driver:**
- Each driver competes in **one** season class — the class in which they have the most `Entry` rows that season. Ties broken by earliest event date.
- Entries the driver makes in any other class (e.g. C5 at event 1, C4 at event 2 → season class = whichever has more entries; a tie of 1-1 resolves to C5 since its event came first) are **excluded from season standings entirely**. Those entries still appear normally in per-event leaderboards.
- **Co-drives** are represented in AxWare as separate `Driver` records (numbered `337` and `337X`); each scores independently. There is no same-driver / same-class / same-event collision case to handle in code.

**Eligibility:**
- Minimum **4 scoring events in the driver's season class** (events where the driver had at least one CLEAN run) for an "official" standing.
- Drivers below the threshold are flagged "Provisional · N/4" and still rendered, so the leaderboard remains useful early in the season (e.g. with only 2 events ingested, every driver renders as provisional). Their `totalPoints` is the sum of whatever scores they have — no zero-fill for absences.

**Scope (RMR-only for MVP):** 7-event / best-4-of-7 is the RMR PCA 2026 rule. Other regions or future rule changes are out of scope for M1.9; revisit when we have a `Region` or per-season `RuleSet` entity (see post-MVP).

**Routes & navigation:**
- New: `apps/web/src/app/leaderboard/page.tsx` — current season (derived as the latest year present in `Event.date`).
- New: `apps/web/src/app/leaderboard/[year]/page.tsx` — historical seasons (e.g. `/leaderboard/2025`).
- Update site header in `apps/web/src/app/layout.tsx:33–42`: the static `RMR · 2026 Season` chip becomes real nav. Add **Events** (home) and **Leaderboard** links plus a small season switcher (dropdown or pill row) listing every distinct year present in the DB — no hard-coded years.
- Update home page (`apps/web/src/app/page.tsx`) — currently lists all events with no year filter and a hard-coded "2026 Season" header. Once 2025 lands, filter the home list to the current season and surface a matching year picker.

**Data model & query approach:**
- **No schema change for MVP.** Derive season year via `event.date.getFullYear()`. Query helper: `where: { date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } }`.
- **Future migration noted (post-MVP):** add `Event.seasonYear Int` (indexed) so season is decoupled from calendar year and queries avoid per-row date math. Out of scope for M1.9 but logged in the post-MVP list so we don't forget.

**Computation library:**
- New file `apps/web/src/lib/season-leaderboard.ts`. Reuses the CLEAN-filter + cone-correction pattern from `bestPaxMsForEntry()` in `src/lib/driver-history.ts` (factor out a shared `bestCorrectedMsForEntry()` helper, or duplicate the few lines — the existing helper applies a PAX multiplier we explicitly don't want here). `CONE_PENALTY_MS` already lives in `src/lib/constants.ts`.
- Algorithm:
  1. Load all events in the season + their entries + clean runs.
  2. For each event, group entries by **entered class** (`Entry.classId` → `CarClass.code`).
  3. Per (event, class): find `min(bestCorrected)` across entries with at least one CLEAN run; assign each scoring entry `points = round(1000 * fastest / theirs)` (winner = 1000; ties earn 1000 each).
  4. **Derive each driver's season class** = the class with the most `Entry` rows that season, ties broken by earliest event date.
  5. Per driver: filter scored entries to their season class only, sort points desc, take top 4, sum into `totalPoints`. Mark `eligible = (eventsInSeasonClass >= 4)`.
- Returns per-class standings: `{ classCode, drivers: [{ driverId, name, totalPoints, eligible, eventsCountedInClass, eventScores: [{ eventSlug, points, dropped: boolean }] }] }`.

**UI:**
- `/leaderboard` renders class sections (or tabs) reusing the shadcn `Table` styling from the per-event leaderboard. Columns: rank, driver name (link to `/drivers/[id]`), total points, per-event score chips with dropped scores visually muted.
- Provisional drivers (`eligible: false`, i.e. fewer than 4 scoring events in their season class) render with a `Provisional · N/4` badge next to the driver name. They still sort by `totalPoints` alongside official drivers — the badge does the visual work.
- Driver names continue to use redacted `First L.` form automatically — `Driver.lastInitial` is the only persisted shape (§2.6).

**Historical 2025 ingest:** the existing `pnpm ingest <path-to-axdb>` CLI handles 2025 files unchanged — `Event.axdbSha256` keeps re-ingests idempotent and `event.date` already carries the year. Prerequisite: DC has the 2025 `.axdb` files locally (see open question #8).

**Definition of Done:**
- New routes return server-rendered, sortable per-class standings.
- A driver who attended only 1–2 events appears flagged "Provisional" with that many scoring rows; a driver who attended all 7 in their season class shows 4 counted + 3 dropped.
- Vitest coverage in `apps/web/tests/` for: class-winner = 1000, fractional scoring math, best-4 selection (verify dropped rows don't contribute to totals but still render), zero-attendance driver excluded, **season-class derivation (most-entered wins; ties resolve to earliest event), off-class entries excluded from season standings**, eligibility flag (driver with <4 in-class scoring events is `Provisional`, ≥4 is official).
- Header nav renders and the season switcher offers exactly the years present in the DB (no hard-coded `2026`).

### M2 — MSR OAuth (target: 1 session once credentials land — BLOCKED on credentials)

- Route handlers: `app/api/auth/msr/login`, `app/api/auth/msr/callback`.
- Issue signed session cookie containing `msrUid`.
- `/me` page renders `/rest/me` server-side using the stored access token.
- Negative-path: missing/expired token redirects to `/login`.

### M3 — Public calendar (target: 0.5 session, after M2)

- `/calendar` server-fetches `/rest/calendars/organization/{RMR_ORG_ID}`.
- Cache 5 min with `unstable_cache` or fetch revalidation.

### M4 — Admin upload (target: 1 session, after M3)

- `POST /api/admin/ingest` (multipart). Authorize via session AND admin allowlist.
- Reuses M1 ingest module. Returns ingest summary (drivers, runs, dispositions).
- Validate that the upload is a real SQLite file (magic-number sniff + `PRAGMA quick_check`).

### M5 — Media hub (target: 1 session)

- SmugMug: render an embed by event date once we know RMR's gallery URL pattern (see open questions).
- Video submission form: `POST /api/videos`, authenticated only. URL allowlist: youtube.com / youtu.be / vimeo.com.

---

## Part 4 · Definition of Done

- **Type safety:** `"strict": true` everywhere; `any` is forbidden. CI runs `tsc --noEmit`.
- **Ingestion correctness:** integration test ingests the synthetic `apps/web/tests/fixtures/synthetic.axdb` (committed) and asserts:
  - 5 drivers, 14 runs, 3 classes (codes `C1`, `CS`, `TO`),
  - exactly 1 `DNF` and 1 `RRN`,
  - class PAX multipliers preserved (`C1`=1.0, `CS`=0.92, `TO`=0.85),
  - **every persisted `Driver.lastInitial` matches `/^[A-Z?]\.$/`** (no full last names reach the app DB),
  - no Driver, Entry, or Run row contains a substring matching any source last name beyond the first character (regex sweep on the dumped DB).
  Regenerate the fixture via `node apps/web/tests/fixtures/build-synthetic-axdb.mjs`. Real `2026_season_data/*/.axdb` files are gitignored (member PII) and never used as test fixtures.
- **Auth boundary:** every route under `/api/admin/*` returns 401 unless the session is present and `msrUid` is in the `ADMIN_MSR_UIDS` env-var allowlist (post-MVP: DB-backed roles).
- **Public reads** of completed event leaderboards do **not** require auth (matches the Driver/Competitor persona).
- **Vercel:** preview deploy for every PR; main deploys to production on merge.

---

## Part 5 · Open Questions (block specific milestones)

| # | Question                                                                                             | Blocks  | Owner |
|---|------------------------------------------------------------------------------------------------------|---------|-------|
| 1 | MSR OAuth credentials — **requested 2026-05-18**, awaiting MSR's response. Also need RMR org ID.     | M2, M3  | DC    |
| 2 | RMR's MSR organization ID (for `/rest/calendars/organization/{org_id}`).                             | M3      | TBD   |
| 3 | SmugMug: existing RMR gallery account + URL pattern, or per-event user-submitted galleries?          | M5      | TBD   |
| 4 | ~~Vercel free tier OK for MVP? Custom domain plan?~~ **Resolved 2026-05-19:** Turso (libSQL) is the hosted DB; Vercel hosts the app on the free tier. Custom domain `launchcontrol.club` registered, to be attached in M1.5b. | Deploy  | DC    |
| 5 | Admin allowlist: which MSR UIDs / emails bootstrap as admin?                                         | M4      | TBD   |
| 6 | Series scoring (cumulative across events) — in MVP, or post-MVP? Source CSVs exist in season data.   | Scope   | TBD   |
| 7 | Drivers without `member_num` produce duplicate rows under redaction. Acceptable for MVP? Real-event smoke shows N collisions: TBD on first real ingest. | Ingest  | DC    |
| 8 | ~~2025 historical `.axdb` files — do we have all 7 events on hand? Any missing or corrupt that would leave gaps in a 2025 season leaderboard?~~ **Resolved 2026-05-21:** Deferred from M1.9. Navigation/season-switcher shape still built so 2025 can slot in later when the data is available. | Post-MVP | DC |
| 9 | SmugMug integration is single-tenant (hard-coded `rmrpca` / `Autocross` defaults). Acceptable to leave as-is through MVP, or do we need per-event overrides before M5 ships? | Post-MVP | DC |
| 10 | ~~Same-driver, same-class, same-event co-drives (rare) — score both `Entry` rows independently and show both in season standings, or collapse to the driver's better score?~~ **Resolved 2026-05-21:** Not a real case. Co-drives are represented in AxWare as separate `Driver` records (`337` + `337X`); each scores independently. Single-class-per-driver season rule (see §M1.9) means there's no same-driver/same-class/same-event collision to handle in code. | Resolved | DC |

---

## Appendix · Post-MVP deployment hardening

Out of scope for the MVP but noted to keep prior thinking discoverable:

- **Containerization** (Docker / `docker-compose`) for parity between dev, preview, and prod.
- **Background ingestion worker** if `.axdb` uploads outgrow Vercel function limits.

## Post MVP Feature Ideas
* Allow driver to add tunes, tires, setup changes to a "vehicle timeline" which should expose performance impact of changes made.
* ~~Allow driver to track performance against leaders or specific rivals visually.~~ **Shipped in M1.7** for "vs. event leader." Specific-rival comparison still open.
* Generalize SmugMug integration beyond RMR/Autocross: per-event folder overrides (admin-set), or per-region config keyed off a future `Region` entity. Optional admin UI to confirm/override fuzzy matches.
* Add explicit `Event.seasonYear Int` column (migration + ingest update) so season is decoupled from calendar year and indexed for fast season queries — M1.9 derives the year from `Event.date` for MVP simplicity.
* Series scoring rules as data: RMR's 7-events / best-4-of-7 rule lives in code today (M1.9). Future regions or rule changes would want a per-season `RuleSet` (events-counted, points formula, drop-week count, tiebreakers).


## Feedback on PRD from other devs

- [ ] Use the /identifier-naming skill on that PRD just to double-check the names of tables, variables, etc.
- [ ] Prisma has great DX, but if things get complex with queries you might prefer Drizzle ORM
- [x] If using SQLite, the Turso library is great to have local/remote duality
- [ ] For OAuth (or authentication in general), I recommend Better Auth, so you don't have to build your own auth manually
- [ ] For Calendars and scheduling you can use cal.com (they have an open source version)


