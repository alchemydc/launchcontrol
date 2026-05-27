# PCA Launch Control — Build Reference

Implementation reference and build history for [Launch Control](https://launchcontrol.club). Companion to [PRD.md](./PRD.md), which holds requirements.

---

## Current Status

**Status (2026-05-26):** M0 ✓ · M1 ✓ · M1.5a ✓ · M1.5b ✓ · M1.6 ✓ · M1.7 ✓ · M1.8 ✓ · M1.9 ✓ · M1.10 ✓ · M1.11 ✓ · M1.12 ✓ — public preview is live at [launchcontrol.club](https://launchcontrol.club) (Vercel + Turso libSQL), with last-name redaction, racing-red styled UI, GitHub Actions CI (lint/typecheck/test/build on every PR), a per-driver progression page (`/drivers/[id]`) charting raw/PAX/best-of progression and time-delta vs. event leader across the season, SmugMug photo album links surfaced on home + event pages, the RMR season points leaderboard at `/leaderboard` (best-4-of-N, per-class standings, multi-season nav), and an ingest correctness pass — batched writes, identity-hash driver dedupe, ghost-registration skip — that unblocks the 2025 backfill and the imminent Turso re-ingest, plus a backfill tooling pass — bulk ingest with canonical-axdb selection and a schema-only DB wipe utility that preserves Turso URLs/keys. **Next up:** M2 — MSR OAuth (credentials received 2026-05-27, untested in app; ready to execute).

---

## Architecture Overview

### System Context

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
   [ Uploaded VisualAX .axdb (SQLite) ]

External:
[ Next.js ] ──OAuth 1.0a──▶ motorsportreg.com (request / authorize / access)
[ Next.js ] ──REST──────▶ api.motorsportreg.com/rest/* (with stored access token)
```

The "SQLite app DB" above is **SQLite locally** and **Turso (libSQL) in preview/prod** — same SQL dialect, swapped at the Prisma driver-adapter layer. See "Database Hosting" below for rationale. No Docker, Nginx, or Tailscale in the MVP.

### MSR OAuth 1.0a (verified)

Verified against MSR's developer page at `api.motorsportreg.com` (May 2026).

**Three-legged flow, HMAC-SHA1 signing (RFC 5849):**

| Step                 | Method/URL                                                                            |
|----------------------|---------------------------------------------------------------------------------------|
| 1. Request token     | `POST https://api.motorsportreg.com/rest/tokens/request` — requires `oauth_callback`; response is `application/x-www-form-urlencoded` per RFC 5849 |
| 2. User authorize    | Redirect to `https://www.motorsportreg.com/index.cfm/event/oauth?oauth_token={token}` — on approve, MSR redirects to your callback with `oauth_token` and `oauth_verifier` query params |
| 3. Access token      | `POST https://api.motorsportreg.com/rest/tokens/access`                               |
| 4. Authenticated API | `Authorization: OAuth …` header (+ `X-Organization-Id` for org-scoped reads)          |

**MVP endpoints consumed:**

- `GET /rest/me` — user profile + org memberships (drives login + `/me` page).
- `GET /rest/calendars/organization/{org_id}` — RMR event calendar (drives `/calendar`).

**Library:** `oauth-1.0a` (npm) + Node `crypto` for HMAC-SHA1. Avoid heavyweight passport plugins; the flow is small enough to implement directly inside Route Handlers.

**Credentials:** request via MSR's [REST API integration page](https://info.motorsportreg.com/rest-api-integration). Requires admin access on the PCA RMR MSR organization. **Credentials received 2026-05-27 (untested in app).**

### VisualAX Source Schema (observed)

Observed by running `.schema` and sample `SELECT`s against the gitignored `2026_season_data/*/*.axdb` files during initial spike. Both files share the same schema.

```sql
events(id, event_name, event_date, num_runs, mirrored, unique_numbers,
       org_name, timing_mode, typical_time, web_active, run_timestamp)
-- num_runs: configured runs-per-driver cap. Excess runs are flagged "X" in VisualAX
--           reports and excluded from registrations.bestcommittedrun_id.
-- unique_numbers: configures whether car numbers must be unique across all classes
--                 (RMR-style) or unique within each class only (SCCA-style). Our
--                 ingest doesn't depend on car-number uniqueness either way.

classes(id, class_name, paxed_class, pax, run_timestamp)
-- pax: float multiplier. class_name examples seen: C1..C5, CS, TO
-- paxed_class: flags region-specific PAX-adjusted classes (eXpert, Novice). RMR
--              doesn't use this feature and our CarClass model doesn't represent it.

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
-- status: 0=pre-start queue, 1=on course, 2=post-finish queue,
--         3=committed, 4=cancelled (left pre-start without crossing line)
--         Ingest reads only status=3; other states are queue/lifecycle
--         artifacts and never represent a scoreable run.
-- disposition: '' (clean), 'DNF', 'RRN' (re-run), 'OFF' (off-course),
--              'DSQ' (disqualified). OFF/DSQ are rare but real.
```

**Observed real-data quirks (catalogued during the 2025 backfill, 2026-05-23):**

- **`member_num` is family/account-level, NOT a person-unique GUID.** Distinct humans frequently share a `member_num` (PCA family/household memberships). Real 2025 data showed multiple shared-`member_num` cases per event: typically two family members in the same class on a single membership, but also pairs with different surnames sharing one membership. `member_num` alone cannot identify a driver — see the Ingestion Strategy section for the identity-hash strategy ingest uses to cross-link the same human across events without false collapses.
- **Co-driver pattern** — in RMR practice usually uses a `1`-prefix or `X`-suffix on the car number — e.g. primary `#62` + co-drive `#162`, primary `#34` + co-drive `#34X`, primary `#198` + co-drive `#198X`. VisualAX itself imposes no co-driver numbering rule; ingest does not pattern-match on car numbers (driver identity is identity-hash-based, not number-based). The co-driver's `member_num` may be empty (non-member co-driver, observed 2025-07-12) OR may share the primary's (family-co-drive case observed 2025-09-13). Ingest doesn't assume either case.
- **Ghost registrations:** VisualAX leaves the original `drivers` row in place when a driver swaps cars on race day — the abandoned registration has zero `runs` rows. 2026-05-17 had 8 such ghosts (drivers who pre-registered with one car number then drove a different one). Ingest skips zero-run rows (see Ingestion Strategy); PCA Series output ignores them anyway.
- **Multiple `.axdb` per event directory.** VisualAX folders can hold a `*Trailer Export*.axdb` (mid-event/trailer snapshot) alongside the canonical post-event export, and very occasionally more than one canonical candidate. The new `apps/web/scripts/ingest.sh` skips any file whose name matches `*Trailer Export*.axdb`, auto-ingests when a directory has exactly one remaining candidate, and prompts the operator to choose (or skip) when multiple remain. Non-interactive runs with multiple candidates fail loudly rather than guess.
- **`registrations.bestcommittedrun_id` is authoritative.** When the timing chief commits a specific run as the official best (typically post-hoc, occasionally overriding the raw-fastest CLEAN run), VisualAX records the chosen `runs.id` here. Confirmed by RMR's timing chair on 2026-05-26. Pre-2025-09-23 events can show this field disagreeing with the raw-fastest CLEAN run due to an VisualAX bug fixed on that date; in every observed case the field still represents the club's official rendering, so ingest treats it as ground truth and falls back to "fastest CLEAN, cone-corrected" only when null.
- **Excessive runs.** When a driver takes more than `events.num_runs` (e.g. 9 runs at an 8-run event), VisualAX flags the excess runs with an "X" column in detailed reports and `registrations.bestcommittedrun_id` / `bestcommittedrun_no` already exclude them. Our `Entry.bestCommittedRunNumber` path inherits this correctness automatically. Residual gap: when `bestCommittedRunNumber` is null, `bestCorrectedMsForEntry()`'s fallback to `min(rawTimeMs + cones * CONE_PENALTY_MS)` over CLEAN runs does not filter on `num_runs` — an excessive run could in principle become the fallback best. Low risk in practice (`bestcommittedrun_id` is reliably populated post-event; fastest CLEAN typically lands within the first N runs). Logged for future hardening.

The `.axdb` format supports **multiple events per file** — VisualAX's season-points feature — and also supports cross-file merging via a manual CSV export/import roundtrip inside VisualAX. Every RMR export observed to date has been single-event (id=1) with ~70–80 drivers and ~600–650 runs. Ingest enforces single-event with a fail-loud guard (see Ingestion Strategy → Single-event assumption below) to prevent silent partial ingest if that ever changes.

### Target App Schema (Prisma + SQLite)

Times are integer milliseconds throughout to avoid float drift.

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
  id           Int      @id @default(autoincrement())
  msrUid       String?  @unique
  firstName    String
  lastInitial  String                       // single uppercase letter + period, e.g. "K." — never the full last name; enforced at ingest
  identityHash String   @unique             // SHA-256 of `${memberNum ?? ''}|${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}` — cross-event person identity. Full last name is used transiently for the hash and never persisted.
  memberNum    String?                      // family/account-level in VisualAX; NOT person-unique. Stored for display/lookup only — the upsert key is identityHash.
  entries      Entry[]
  videos       Video[]
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
  bestCommittedRunNumber Int?   // VisualAX-authoritative best-run pointer; resolved from registrations.bestcommittedrun_id by looking up its position in the driver's sorted-by-id source runs. Null when VisualAX emits no committed best.

  // No @@unique on (eventId, driverId): a person can enter the same event
  // multiple times via co-drives or multi-class entries.
  @@index([eventId])
  @@index([driverId])
}

// CLEAN is the only disposition counted toward best-time; the rest are persisted for auditing only.
enum RunDisposition { CLEAN  DNF  RRN  OFF  DSQ }

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
- `best_corrected_time_ms` = if `entry.bestCommittedRunNumber != null` and that run is persisted with `rawTimeMs != null`, return `rawTimeMs + cones * CONE_PENALTY_MS` for that run; **else** `min(rawTimeMs + cones * CONE_PENALTY_MS)` across the entry's CLEAN runs. Null when no qualifying run exists.

### UI Components (shadcn/ui)

Components are copied into `components/ui/` — not pulled as a versioned dependency — so the design system stays editable in-repo. Built on Radix primitives + Tailwind.

| Surface                              | Components used                                            |
|--------------------------------------|------------------------------------------------------------|
| `/events/[slug]` leaderboard         | `data-table` (TanStack Table) · `badge` · `card` · `tabs`  |
| `/calendar`                          | `card` · `badge` · `skeleton`                              |
| `/login`, `/me`                      | `button` · `card` · `avatar`                               |
| `/admin/ingest` upload form          | `form` · `input` · `button` · `dialog` · `toast` (`sonner`)|
| Video submission form                | `form` · `input` · `select` · `button` · `toast`           |

Dark mode is in scope for M0 (Tailwind `class` strategy + a small theme toggle).

### Ingestion Strategy

Library: **`better-sqlite3`** (synchronous, fast, no async overhead). It builds natively on macOS/Linux dev machines.

- **M1 (local CLI):** `pnpm ingest <path-to-axdb>` opens the source with `new Database(path, { readonly: true })`, reads `events` / `classes` / `drivers` / `registrations` / `runs`, and upserts into Prisma inside a single transaction. Idempotent on re-run (keyed by `(eventId, driverId)` and `(entryId, runNumber)`).

**Single-event assumption:** ingest reads exactly one `events` row from the source file and throws a clear error if the source contains more than one. The `.axdb` format permits multi-event files (VisualAX's season-points feature) but RMR has never used it; the guard prevents silent partial ingest if that ever changes. Full multi-event support is deferred to post-MVP.

- **M4 (admin upload):** accepts a multipart `.axdb`, writes it to a tmp file, and runs the same code path. **Vercel constraint:** the function must use the Node.js runtime (not Edge) and may need a higher memory tier; `better-sqlite3` ships native bindings that require Vercel's Node 20 runtime.

Mapping rules:

| VisualAX source                              | App table / field                                            |
|--------------------------------------------|--------------------------------------------------------------|
| `events.event_name`, `event_date`          | `Event.name`, `Event.date`                                   |
| `classes.class_name`, `classes.pax`        | `CarClass.code`, `CarClass.paxIndex` (upsert by `code`)      |
| `drivers.first_name`                       | `Driver.firstName` (verbatim)                                |
| `drivers.last_name`                        | `Driver.lastInitial` = `last_name.trim()[0].toUpperCase() + '.'` — **full last name is never persisted** |
| `drivers.member_num`                       | `Driver.memberNum` (stored for display; **not** the upsert key — family/account-level, not person-unique) |
| `drivers.first_name` + `drivers.last_name` + `drivers.member_num` (normalized) | `Driver.identityHash` — SHA-256, the actual cross-event person upsert key. Last name used transiently; never persisted. |
| `registrations`                            | `Entry` (one row per driver-event)                           |
| `runs.finish_tick - runs.start_tick`       | `Run.rawTimeMs` (null when disposition='DNF' and no time)    |
| `runs.cones`                               | `Run.cones`                                                  |
| `runs.disposition`                         | `Run.disposition` (`''→CLEAN`, `'DNF'→DNF`, `'RRN'→RRN`)     |
| `runs.status` | filtered at ingest — rows with `status != 3` are skipped (queue/cancelled artifacts) |
| `runs.disposition` `'OFF'` / `'DSQ'` | `Run.disposition = OFF` / `DSQ`; persisted but excluded from best-time |
| `registrations.bestcommittedrun_id` | `Entry.bestCommittedRunNumber` — resolved by finding the FK's position in the driver's sorted-by-id source runs (1-indexed). VisualAX's sibling `bestcommittedrun_no` field is unreliable because it skips voided RRN slots while our `Run.runNumber` numbers them sequentially. Nullable; takes precedence over fastest-CLEAN at compute time. |

**Driver identity (M1.10):** ingest computes `identityHash = SHA256(${memberNum ?? ''}|${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()})` and uses it as the cross-event upsert key. This keeps family members on a shared `member_num` as distinct `Driver` rows while still cross-linking the same human across events. Drivers without a `member_num` are deduplicated by name alone — residual risk of two unrelated people with identical first+last names colliding is small at PCA RMR scale and accepted for MVP. The full last name is used only to compute the hash; nothing beyond the redacted `lastInitial` is ever persisted.

**Ghost registrations:** any source `drivers` row with zero matching `runs` rows is skipped at ingest with a console warning. These are abandoned pre-registrations from drivers who swapped cars on race day; PCA Series export ignores them and so do we.

**Write strategy (M1.10, closes issue #7):** the inner loops use `createMany` + recovery `findMany` rather than per-row `upsert` calls, collapsing ~200–700 round-trips per event down to ~6–10. This unblocks Turso (HTTP-per-round-trip) without holding interactive transactions open over the network.

**Best-time preference (M1.12):** All best-time consumers (per-event leaderboard, driver progression, season standings) call `bestCorrectedMsForEntry()` in `apps/web/src/lib/entry-best.ts`. That helper prefers `Entry.bestCommittedRunNumber` when set and the referenced run has a `rawTimeMs`, falling back to `min(rawTimeMs + cones * CONE_PENALTY_MS)` over CLEAN runs only.

**Unknown dispositions throw.** `toDisposition()` recognizes exactly `''`/`'DNF'`/`'RRN'`/`'OFF'`/`'DSQ'` and throws on anything else, so a future VisualAX disposition can't silently fall through to CLEAN.

### Database Hosting — Turso (libSQL)

The original M0 plan put SQLite directly on the host. That works locally but **blocks Vercel deploys**: Vercel's serverless functions have an ephemeral filesystem with no shared state between invocations, so a single-writer SQLite file cannot be the production DB. This was discovered at the first attempted preview deploy after M1.

**Decision: keep SQLite locally; use Turso (libSQL) for preview + production.** Turso is a hosted, SQLite-compatible (libSQL) database with an HTTP wire protocol designed for serverless.

| Option              | Why considered                                  | Why not chosen for MVP                                                                                  |
|---------------------|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| **Turso (libSQL)**  | API key already procured; SQLite-compatible     | **Chosen.** See below.                                                                                  |
| Supabase Postgres   | Native Decimal/enum, broad feature set          | Free tier pauses inactive DBs; Supavisor pool URL config is a known foot-gun; Docker for local parity   |
| Neon serverless PG  | Excellent serverless latency; CI branching      | Best-in-class but requires full Postgres migration; benefit not worth the time at MVP scale             |
| Vercel Postgres     | Vercel-integrated provisioning UI               | It's Neon underneath; adds a layer of indirection with no technical gain                                |
| Cloudflare D1       | SQLite-shaped; great free tier                  | Workers-only runtime; incompatible with Vercel Node functions                                           |

**Why Turso for this MVP:**

- **Smallest migration:** the existing schema already targets `provider = "sqlite"` and we're already on the Prisma 7 driver-adapter pattern (`@prisma/adapter-better-sqlite3`). Swap to `@prisma/adapter-libsql` + a different `DATABASE_URL`. No schema model changes.
- **Local-dev unchanged:** `file:./dev.db` for local, Turso remote URL in `.env.preview` / Vercel env. Same driver adapter both sides; no Docker, no daemon.
- **Latency:** Turso's HTTP protocol is stateless per request (no pooler needed). ~10–30ms added per query from a warm Vercel function — imperceptible for read-heavy public leaderboards at our scale.
- **Free tier:** 9 GB storage / 1B row-reads per month. We will never approach this.

**When we'd revisit:** if we ever need native Postgres features (full-text search via `tsvector`, JSONB querying, PostGIS), or if we want per-PR DB branching wired into CI.

**Local-only secrets:** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` live in Vercel env vars (preview + prod) and a developer's `.env.local` for those who want to point local dev at Turso. The default local dev path stays `file:./dev.db`.

---

## Milestone History

### M0 — Scaffold ✓ (done 2026-05-18)

- `pnpm create next-app` with TypeScript, App Router, Tailwind, ESLint.
- `pnpm dlx shadcn@latest init` (Neutral base, CSS variables, `@/*` alias); preinstall the components M1 will need (`button`, `table`, `card`, `badge`, `input`, `label`).
- Add Prisma + SQLite + `better-sqlite3`; check `prisma/schema.prisma` and an initial migration into the repo.
- Link the repo to Vercel; verify preview deploys on PR.
- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`.
- `2026_season_data/` is **gitignored** (member PII); developers keep `.axdb` files there locally for smoke testing.
- Build a small **synthetic** `.axdb` for CI/test fixtures and commit it under `apps/web/tests/fixtures/`.

**Not yet done in M0:** Vercel project link (requires interactive `vercel login` / GitHub remote) — deferred to deployment session.

### M1 — Static leaderboard ✓ (done 2026-05-18)

- `src/lib/ingest.ts` — reusable ingest module (read-only `better-sqlite3` against VisualAX source, normalize into Prisma in a single transaction, idempotent via `Event.axdbSha256`).
- `scripts/ingest.ts` — thin CLI; wired as `pnpm --filter web ingest <path-to-axdb>` (resolves the path against `$INIT_CWD` so relative paths work from the repo root).
- Vitest integration tests against the synthetic fixture (`pnpm --filter web test`).
- `/` lists events from the DB; `/events/[slug]` renders a sortable, class-filterable leaderboard (Raw / PAX / per-run badges) using shadcn `Table` + `@tanstack/react-table` state.
- Real-event smoke: both `2026_season_data/*/.axdb` files ingest cleanly into local dev.db.
- **Schema correction during M1:** dropped `@@unique([eventId, driverId])` on `Entry` — autocross allows co-drives and multi-class entries (same person → multiple entries at one event). Migration: `20260518230343_entry_allow_multi`.
Note that static leaderboard is *not* yet using tailwind styling or shadcn table, icons, etc.

### M1.5a — PII redaction + standalone smoke test ✓ (done 2026-05-19)

Land redaction on its own first so the change is reversible and the new assertions can stabilize before we also move the DB underneath them.

- **Schema:** rename `Driver.lastName` → `Driver.lastInitial` (`String`). Migration name: `entry_redact_last_initial`.
- **Ingest:** introduce a `redactLastName(name)` helper: trim, take first char, uppercase, append `.`; blank/whitespace input → `?.`. Use it in the driver upsert path. Stop reading or persisting full last names.
- **Display:** update `EntryWithRelations.driver` type and the `driverName` template literal to `${firstName} ${lastInitial}`.
- **Tests:** add assertions that every `Driver.lastInitial` matches `/^[A-Z?]\./` and a regex sweep confirms no fixture last name (`Ada`, `Brook`, `Chen`, `Diaz`, `Eckhart`) appears in any column beyond its first character.
- **Smoke test:** ingest both gitignored `2026_season_data/*/.axdb` files into local `dev.db`, run `pnpm dev`, and visually confirm the leaderboard shows `First L.` for every driver.

### M1.5b — Turso migration + first Vercel preview deploy at `launchcontrol.club` ✓ (done 2026-05-19)

- **DB driver swap ✓:** replaced `@prisma/adapter-better-sqlite3` with `@prisma/adapter-libsql`. The Prisma singleton in `src/lib/prisma.ts` instantiates from `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` when set, else falls back to local `file:./dev.db` via libSQL.
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
- **System-controlled dark mode:** added `@media (prefers-color-scheme: dark) :root { ... }` alongside the existing `.dark` class variant, so the OS pref controls theme without JS, no FOUC, no `next-themes` dependency.
- **Site chrome (`app/layout.tsx`):** sticky top header with the wordmark "Launch Control" linking to `/` and a muted `RMR · 2026 Season` kicker; footer with PCA RMR attribution. Page metadata updated from "Create Next App" to a real title template and description.
- **Home page:** kicker + accent strip hero, event list wrapped in a soft tinted panel, card hover lifts to `border-primary/40` + `group-hover:text-primary`.
- **Leaderboard:** added a rank column derived from the current sort (top-1 in `text-primary font-bold`, top-3 semibold, rest muted) with a subtle `bg-primary/5` accent on the leader row; added a `success` Badge variant for clean runs so DNF/RRN (now red, matching destructive) stand visually apart.

No UI tests added — the change is purely presentational. Deferred from the original M1.6 plan: README screenshot smoke check (deferred to M1.5b when there's a Vercel preview URL to link).

### M1.7 — Driver progression page ✓ (done 2026-05-20)

A first cut of the "track performance against leaders/rivals visually" post-MVP idea landed early because the data was already in-DB and the leaderboard alone wasn't telling a season story.

- **Route:** `/drivers/[id]` — server-rendered (`force-dynamic`), shows the driver's per-event history table plus two Recharts panels.
- **Lib:** `src/lib/driver-history.ts` — assembles a driver's events chronologically with raw best, PAX best, and the event-leader PAX time for delta computation.
- **Charts:**
  - `ProgressionChart` — raw best vs. PAX best vs. running best-of-season per driver across events.
  - `TimeDeltaChart` — driver's PAX best minus the event-leader PAX best (always ≥ 0; the leader sits at the x-axis). Y-axis clamped to 0 so the leader visually anchors the chart. Tooltip copy reads "vs. event leader".
- **Dark mode:** chart palette pulled from the racing-red CSS variable set so both light and dark modes read correctly (initial deploy had washed-out chart colors in dark mode — fixed before the merge).
- **Linking:** leaderboard driver names link to `/drivers/[id]`.

**Test coverage ✓ (done 2026-05-21):** `apps/web/tests/driver-history.test.ts` lands 15 vitest cases against `src/lib/driver-history.ts`. Coverage: CLEAN-filter, cone penalty, PAX multiplier + rounding, null-rawTimeMs handling, chronological order, absent-event omission, pooled-PAX position ranking (including the case where a CS driver out-PAXes a C1 driver), leader & median delta math, DNF-only event rendered with nulls but still in the array, percentile, and empty-history.

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
  - Post-MVP generalization sketch: per-event SmugMug folder override (admin-set), or per-region config keyed off a future `Region` entity.

### M1.9 — RMR season leaderboard ✓ (done 2026-05-21)

A season-long points standings page across each car class, plus the navigation shape to support both the current 2026 season and a historical 2025 season (data backfill in scope).

**Scoring rules (RMR PCA 2026 — region-specific):**
- 1000 points per event to the fastest driver in each class.
- All other drivers in the class earn `points = round(1000 * fastest_class_time / driver_best_time)`. Ties for fastest → all tied drivers earn 1000.
- "Best time" = best CLEAN run, corrected for cones (`raw_time_ms + cones * CONE_PENALTY_MS`). **No PAX adjustment** — drivers are already class-scoped.
- Season is 7 events. **Best 4 scores per driver count** toward the season total; the other 3 are dropped (but still rendered, visually muted, for transparency).

**Single season class per driver:**
- Each driver competes in **one** season class — the class in which they have the most `Entry` rows that season. Ties broken by earliest event date.
- Entries the driver makes in any other class are **excluded from season standings entirely**. Those entries still appear normally in per-event leaderboards.
- **Co-drives** are represented in VisualAX as separate `drivers` rows; each scores independently. Entry recovery uses `(driverId, classId)` as the key; the truly pathological "same human, same class, both with runs" case throws a clear data-anomaly error at ingest rather than silently miscategorizing runs.

**Eligibility:**
- Minimum **4 scoring events in the driver's season class** for an "official" standing.
- Drivers below the threshold are flagged "Provisional · N/4" and still rendered.

**Routes & navigation:**
- `apps/web/src/app/leaderboard/page.tsx` — current season (derived as the latest year present in `Event.date`).
- `apps/web/src/app/leaderboard/[year]/page.tsx` — historical seasons (e.g. `/leaderboard/2025`).
- Site header nav updated: **Events** (home) and **Leaderboard** links plus a small season switcher listing every distinct year present in the DB — no hard-coded years.

**Data model:** No schema change for MVP. Derive season year via `event.date.getFullYear()`. Future migration noted (post-MVP): add `Event.seasonYear Int` (indexed).

**Computation library:** `apps/web/src/lib/season-leaderboard.ts`. `CONE_PENALTY_MS` lives in `src/lib/constants.ts`.

**Historical 2025 ingest:** the existing `pnpm ingest <path-to-axdb>` CLI handles 2025 files unchanged — `Event.axdbSha256` keeps re-ingests idempotent.

### M1.10 — Ingest correctness pass ✓ (done 2026-05-23)

Unblocks the 2025 historical backfill and the imminent Turso re-ingest. Five issues landed together:

- **Batched writes (closes issue #7):** `apps/web/src/lib/ingest.ts` replaces inner per-row `upsert`/`create` loops with `createMany` + recovery `findMany`. Round-trips per event collapsed from ~200–700 to ~6–10. Removed the `{ timeout: 60_000, maxWait: 10_000 }` workaround on `$transaction` — back to defaults. (Prisma 7's `prisma-client` generator does not accept `skipDuplicates` on `createMany`; we pre-filter to new rows so the flag isn't needed.)
- **Driver identity (schema migration `20260524015935_driver_identity_hash`):** dropped `Driver.memberNum @unique` (kept the field, non-unique), added `Driver.identityHash String @unique`. Ingest computes `SHA-256(memberNum, firstName, lastName)` with normalized casing. Fixes the silent data corruption in pre-2026-05-23 ingests, where family members on a shared `member_num` were collapsed into one `Driver` row with last-write-wins names.
- **Ghost registration skip:** source `drivers` rows with zero `runs` rows are filtered before any DB write, with a console warning. VisualAX leaves pre-registrations in place when a driver swaps cars on race day (2026-05-17 had 8 ghosts where pre-registered car numbers had zero runs).
- **Entry recovery by `(driverId, classId)`:** defense-in-depth against the multi-class single-human edge case. A collision throws a clear data-anomaly error rather than silently miscategorizing runs.
- **Landing-page RSC fix:** new `apps/web/src/app/events-year-switcher.tsx` `"use client"` wrapper. Latent bug — gated behind `years.length > 1` and never observed before the 2025 import.

**Test fixture:** added a 6th driver to the synthetic `.axdb` (Andrew Ada sharing `SYN-001` with Alex Ada) for regression coverage of the family-share case. Count assertions bumped (5→6 drivers, 14→17 runs, 12→15 clean).

**Operational note:** locally regenerating the schema can need `DATABASE_URL=file:./dev.db TURSO_DATABASE_URL= pnpm exec prisma migrate dev …` to bypass the libSQL URL when `TURSO_DATABASE_URL` is set in `apps/web/.env`. Prisma's migration engine doesn't speak libSQL.

### M1.11 — Backfill tooling ✓ (done 2026-05-25)

Operator-facing tooling to support the 2025 backfill and Turso re-ingests without surprises.

- **`apps/web/scripts/ingest.sh`** — walks a directory tree, finds one canonical `.axdb` per event folder, and runs `pnpm run ingest` on each. Skips `*Trailer Export*.axdb` (trailer snapshots, not canonical results). When multiple non-trailer files exist in a single event folder, prompts the operator to choose or skip; non-interactive runs error out rather than guess.
- **`apps/web/scripts/wipe-db.ts` (`pnpm --filter web wipe:db`)** — drops every table/view/trigger/index in the target DB (local `file:` or Turso libSQL) but **does not delete the database itself**. Rationale: a full Turso "destroy + recreate" rotates the DB URL + auth token, which would require updating Vercel env vars on preview and prod on every re-ingest cycle. Safety rails: prints the redacted target URL and an itemized drop plan; supports `--dry-run`; for Turso, requires typing the exact hostname to confirm; for local DBs, defaults to a `[y/N]` prompt unless `--yes` is passed.

### M1.12 — Honor `bestcommittedrun_id` + tighten status/disposition filters ✓

Closes the CS P3/P4 anomaly surfaced during the 2025 backfill (`docs/private/ellen_bestcommittedrun_anomaly.md`). Three changes land together because all three are required to match the club's official renderings.

- **Authoritative committed-best:** `apps/web/src/lib/ingest.ts` reads `registrations.bestcommittedrun_id` (FK → `runs.id`) and resolves it to a 1-indexed position in the driver's sorted-by-id source runs, storing that in a new nullable `Entry.bestCommittedRunNumber`. VisualAX's sibling `bestcommittedrun_no` is unreliable for this lookup because it skips voided RRN slots while our `Run.runNumber` numbers them sequentially — the FK is the only stable reference. A new `apps/web/src/lib/entry-best.ts` exports `bestCorrectedMsForEntry()`, which prefers that pointer and falls back to fastest CLEAN cone-corrected. `leaderboard.ts`, `driver-history.ts`, `season-leaderboard.ts` all route through the helper.
- **Status filter at ingest:** the source `runs` SELECT adds `WHERE status = 3`. Rows in queue/cancelled states (0/1/2/4) never reach the app DB. Confirmed defense-in-depth — all observed real-event exports already had status=3 only, but the chair confirmed the lifecycle semantics on 2026-05-26.
- **`OFF` / `DSQ` dispositions:** `RunDisposition` enum extended; `toDisposition()` recognizes them and now **throws** on any unrecognized string (replaces today's silent fallback to CLEAN — the exact class of bug this milestone closes). OFF/DSQ runs persist for auditing but are excluded from best-time.

Backfill: wipe local + Turso schema via `pnpm --filter web wipe:db`, re-migrate, bulk re-ingest 2025+2026 via `apps/web/scripts/ingest.sh`. Verify Ellen G. → CS P4 (2894) and Mike P. → CS P3 (2908) on `/leaderboard/2025`. Verify `docs/private/compare-official.ts` reports `Total mismatches: 0`.

### M2 — MSR OAuth (target: 1–2 sessions; credentials received 2026-05-27)

**Library choices (decided 2026-05-27):**
- `oauth-1.0a` (npm) + Node `crypto` for HMAC-SHA1 request signing.
- `iron-session` for encrypted session cookies (App Router-native, stateless, AES-256-GCM).
- Not NextAuth/Auth.js: v5 explicitly deprioritizes OAuth 1.0a, and a single-provider MVP doesn't earn back the dep weight or upgrade tax.

**Token storage (decided 2026-05-27):** cookie-only encrypted session. No `User` Prisma model in MVP — admin allowlist stays env-var-backed (`ADMIN_MSR_UIDS`) per open question #5's existing direction.

**Env vars** (add to `apps/web/.env.example` + Vercel preview/prod):
- `MSR_CONSUMER_KEY`, `MSR_CONSUMER_SECRET` — OAuth consumer creds.
- `MSR_RMR_ORG_ID` — used in `X-Organization-Id` header and `/rest/calendars/organization/{org_id}`.
- `SESSION_SECRET` — 32+ random bytes for iron-session AES-256-GCM key.
- `MSR_OAUTH_CALLBACK_URL` — fully-qualified callback. Production: `https://launchcontrol.club/api/auth/msr/callback`. Preview deploys: derive from request `Host` at runtime so each preview URL works without per-deploy reconfig.

**Three-legged flow:**

1. `GET /api/auth/msr/login` (Node runtime Route Handler):
   - POST `https://api.motorsportreg.com/rest/tokens/request` with `oauth_callback={MSR_OAUTH_CALLBACK_URL}`, signed with consumer key/secret.
   - Parse www-form-urlencoded response → `oauth_token`, `oauth_token_secret`.
   - Stash `oauth_token_secret` in a short-lived signed cookie scoped to `/api/auth/msr/callback`. HttpOnly + Secure (prod) + SameSite=Lax, 10-minute Max-Age.
   - 302 to `https://www.motorsportreg.com/index.cfm/event/oauth?oauth_token={token}`.

2. `GET /api/auth/msr/callback` (Node runtime Route Handler):
   - Read `oauth_token` + `oauth_verifier` from query string.
   - Read `oauth_token_secret` from the short-lived cookie; delete it after read.
   - POST `https://api.motorsportreg.com/rest/tokens/access` signed with consumer + request tokens + verifier.
   - Parse www-form-urlencoded response → access token, access secret, profile id.
   - Fetch `GET /rest/me` signed with the new access token; parse JSON → `msrUid`, `firstName`, `lastName`, `organizations[]`.
   - Apply PII rule: redact `lastName` → `lastInitial` (single uppercase letter + period) before storing.
   - Set iron-session cookie: `{ msrUid, firstName, lastInitial, accessToken, accessTokenSecret, profileId, isRmrMember }` where `isRmrMember = organizations.some(o => o.id === MSR_RMR_ORG_ID)`. HttpOnly + Secure (prod) + SameSite=Lax, 30-day sliding Max-Age.
   - 302 to `/me`.

3. `POST /api/auth/logout`: clear the iron-session cookie; 302 to `/`.

**Pages:**
- `/login` — public. "Sign in with MotorsportReg" button → `/api/auth/msr/login`.
- `/me` — server component, reads the iron-session cookie, renders `First L.` + RMR-membership badge from cookie data (no MSR re-fetch in MVP).

**New library code** (small):
- `apps/web/src/lib/session.ts` — `getSession()` wrapping `getIronSession` with the typed `SessionData` shape.
- `apps/web/src/lib/msr.ts` — `signedMsrFetch(url, accessToken, accessTokenSecret)` for any authenticated MSR API call. Reused by M3 (calendar) and any future authenticated MSR read.

**Error paths:**
- User denies on MSR's authorize page → callback receives no `oauth_verifier` (or an error param) → redirect to `/login?error=denied`.
- `/rest/tokens/access` non-2xx → log + redirect to `/login?error=token-exchange`.
- `/rest/me` non-2xx → log + redirect to `/login?error=profile-fetch`.
- Future protected route with missing/expired session → redirect to `/login`.

**Security:**
- OAuth's `oauth_token` query param on the callback is bound to the cookie-stored `oauth_token_secret` — together they provide callback authenticity (no separate CSRF state token needed).
- All cookies HttpOnly + Secure (prod) + SameSite=Lax.
- Request-token cookie scoped to the callback path only; cleared after callback completes.
- Post-login redirect is hard-coded to `/me` — no open-redirect risk from accepting a user-supplied target.
- `MSR_CONSUMER_SECRET` and `SESSION_SECRET` live only in Vercel env vars; never logged, never sent to the client.

**Open implementation questions (surface during M2, not blocking):**
- Does MSR require the callback URL to match a pre-registered URI, or accept any URL passed via `oauth_callback`? Verify with the first preview-deploy test.
- Does MSR invalidate access tokens after some duration (e.g. when user revokes app authorization in their MSR account)? Detect at fetch time → redirect to re-auth.
- Exact JSON shape of `/rest/me`, specifically the `organizations` field — confirm against the live endpoint and pin the TS interface.
- Sign-in policy: do we *require* RMR membership to sign in, or just record it on the session and gate admin features via the existing allowlist? **Tentative default: record only, don't gate.** Revisit if M4 surfaces a reason to lock down.

**Definition of Done additions:**
- A signed-in user lands on `/me` after a real OAuth handshake against live MSR endpoints.
- Session cookie roundtrips and survives a page refresh; logout clears it; subsequent `/me` hits redirect to `/login`.
- `oauth_token_secret`, `accessTokenSecret`, and consumer secret never appear in DB, logs, or any client-side payload.
- Smoke against at least one non-RMR-member MSR user to confirm `isRmrMember = false` lands correctly in the session.

### M3 — Public calendar (target: 0.5 session, after M2)

- `/calendar` server-fetches `/rest/calendars/organization/{RMR_ORG_ID}`.
- Cache 5 min with `unstable_cache` or fetch revalidation.

### M4 — Admin upload (target: 1 session, after M3)

- Multipart admin-only upload endpoint. Authorize via session AND admin allowlist.
- Reuses M1 ingest module. Returns ingest summary (drivers, runs, dispositions).
- Validate that the upload is a real SQLite file (magic-number sniff + `PRAGMA quick_check`).

### M5 — Media hub (target: 1 session)

- Video submission form: authenticated only. URL allowlist: youtube.com / youtu.be / vimeo.com.
- No comments at this point as this introduces moderation concerns. 

---

## Decisions Log

Resolved open questions from PRD development — preserved here as context for future contributors.

| # | Question | Resolution | Date | Milestone |
|---|----------|------------|------|-----------|
| 1 | MSR OAuth credentials. | Received 2026-05-27 (untested). Stored in Vercel env as `MSR_CONSUMER_KEY` / `MSR_CONSUMER_SECRET`. | 2026-05-27 | M2 (pending) |
| 2 | RMR's MSR organization ID. | Received 2026-05-27. Stored in env as `MSR_RMR_ORG_ID`. | 2026-05-27 | M3 (pending) |
| 4 | Vercel free tier OK for MVP? Custom domain plan? | Turso (libSQL) is the hosted DB; Vercel hosts the app on the free tier. Custom domain `launchcontrol.club` registered and attached. | 2026-05-19 | M1.5b |
| 7 | Drivers without `member_num` produce duplicate rows under redaction. Acceptable for MVP? | Identity-hash strategy dedupes drivers without `member_num` by name; residual cross-event name-collision risk accepted for MVP. | 2026-05-23 | M1.10 |
| 8 | 2025 historical `.axdb` files — do we have all 7 events on hand? | Deferred from M1.9. Navigation/season-switcher shape still built so 2025 can slot in later when the data is available. | 2026-05-21 | M1.9 |
| 9 | SmugMug multi-club generalization. | Deferred to post-MVP. M1.8's single-tenant env-var config is sufficient for RMR-only MVP; promote to per-club entity when a second club adopts the platform. | 2026-05-27 | Future scope |
| 10 | Same-driver, same-class, same-event co-drives — score both `Entry` rows independently or collapse to better score? | VisualAX uses separate `drivers` rows for co-drives (`337` + `337X`, `62` + `162`); each scores independently. Driver identity is the identity hash (not `member_num` — a co-drive pair sharing `member_num` was observed in 2025-09-13 real data). Ingest throws on the truly pathological "same human, same class, both with runs" case. | 2026-05-23 | M1.10 |
| 11 | `bestcommittedrun_id` semantics — authoritative override, UI cache, or one-off bug? | Chair confirmed authoritative; honor when present. 2025-08-16 case traces to an VisualAX bug fixed 2025-09-23. Status values 0–4 enumerated; only `3=committed` should be ingested. `OFF`/`DSQ` dispositions exist and must be excluded from best-time. | 2026-05-26 | M1.12 |
| 12 | Multi-event `.axdb` support. | VisualAX format permits multiple events per file (unused by RMR). Ingest enforces single-event with a fail-loud guard; full multi-event support deferred to post-MVP if a region adopts the season-points feature. | 2026-05-27 | post-M1.12 |

---

## Appendix · Post-MVP Deployment Hardening

Out of scope for the MVP but noted to keep prior thinking discoverable:

- **Containerization** (Docker / `docker-compose`) for parity between dev, preview, and prod.
- **Background ingestion worker** if `.axdb` uploads outgrow Vercel function limits.

---

## Outstanding Review Feedback

- [ ] Use the /identifier-naming skill on that PRD just to double-check the names of tables, variables, etc.
- [x] Prisma has great DX, but if things get complex with queries you might prefer Drizzle ORM
- [x] If using SQLite, the Turso library is great to have local/remote duality
- [x] For OAuth (or authentication in general), I recommend Better Auth, so you don't have to build your own auth manually
- [x] For Calendars and scheduling you can use cal.com (they have an open source version)
- [x] VisualAX author review of PRD (2026-05-27) — clarifications on co-driver numbering, multi-event `.axdb` format, `unique_numbers` / `paxed_class` fields, and excessive-run handling; incorporated into BUILD.md.
