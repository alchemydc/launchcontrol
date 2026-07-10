# PCA Launch Control — Build Reference

Implementation reference and build history for [Launch Control](https://launchcontrol.club). Companion to [PRD.md](./PRD.md), which holds requirements.

---

## Current Status

**Status (2026-07-10):** M0 ✓ · M1 ✓ · M1.5a ✓ · M1.5b ✓ · M1.6 ✓ · M1.7 ✓ · M1.8 ✓ · M1.9 ✓ · M1.10 ✓ · M1.11 ✓ · M1.12 ✓ · M1.13 ✓ · M1.14 ✓ · M2 ✓ · M2.1 ✓ · M4 ✓ · M4.1 ✓ — public preview is live at [launchcontrol.club](https://launchcontrol.club) (Vercel + Turso libSQL), with last-name redaction, racing-red styled UI, GitHub Actions CI (lint/typecheck/test/build on every PR), a per-driver progression page (`/drivers/[id]`) charting raw/PAX/best-of progression and time-delta vs. event leader across the season, SmugMug photo album links surfaced on home + event pages, the RMR season points leaderboard at `/leaderboard` (top-K-of-N where K is the dynamic qualifying threshold, per-class standings, multi-season nav, multi-class & multi-car participation as of M1.14), an ingest correctness pass — batched writes, identity-hash driver dedupe, ghost-registration skip — plus the dynamic qualifying threshold from M1.13. Members can now sign in with their MotorsportReg account via the header nav and view `/me`, which shows their MSR identity and an RMR-membership badge. Event data and leaderboards (event list, event detail, season standings, driver profiles) are now restricted to MSR-authenticated RMR members; unauth and non-RMR visitors see a landing page at `/` and deep links survive sign-in via a sanitized `returnTo` round-trip. Admins can upload `.axdb` files from the browser at `/admin/ingest` — no shell access required — and manage ingested events at `/admin/events`: edit name/date/location (the URL slug regenerates), or delete a bad/duplicate event with full cascade and an orphan-driver sweep, with every admin ingest/edit/delete recorded in a persistent `AdminAuditLog`. **Next up:** M3 — Public calendar (RMR event calendar from /rest/calendars/organization/{org_id}).

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

**Credentials:** request via MSR's [REST API integration page](https://info.motorsportreg.com/rest-api-integration). Requires admin access on the PCA RMR MSR organization. **Credentials verified end-to-end via M2 sign-in flow on 2026-05-28.**

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
- **`registrations.bestcommittedrun_id` is authoritative.** When the timing chief commits a specific run as the official best (typically post-hoc, occasionally overriding the raw-fastest CLEAN run), VisualAX records the chosen `runs.id` here. Confirmed by RMR's timing chair on 2026-05-26. Pre-2025-09-23 events can show this field disagreeing with the raw-fastest CLEAN run due to a VisualAX bug fixed on that date; in every observed case the field still represents the club's official rendering, so ingest treats it as ground truth and falls back to "fastest CLEAN, cone-corrected" only when null.
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

model AdminAuditLog {
  id          Int      @id @default(autoincrement())
  action      String   // "ingest" | "event.update" | "event.delete"
  actorMsrUid String   // MSR UID, or "cli" for scripts/ingest.ts
  actorName   String   // "First L." only — NEVER full last name (PII rule)
  targetType  String   // "event"
  targetId    Int?
  targetSlug  String?
  detail      String   // JSON string (SQLite has no native JSON type)
  createdAt   DateTime @default(now())
  @@index([createdAt])
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

**Note (2026-05-27, amended 2026-06-08):** Three scoring rules in this milestone have moved. The hardcoded "7 events / best 4" was replaced by a dynamic `floor(N/2) + 1` formula in **M1.13**. The single-car-per-season constraint added in M1.13 and the single-season-class-per-driver constraint from M1.9 were both reversed in **M1.14**: drivers now appear in every class they entered, and multiple cars within a class all score. The historical milestone text below is preserved for context but does not describe current behavior.

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

### M1.13 — Dynamic qualifying threshold + single-car constraint ✓ (done 2026-05-27)

**Superseded in part by M1.14 (2026-06-08):** the single-car-per-season constraint described below was reversed by the AX chair. Only the dynamic qualifying threshold (`floor(N/2) + 1`) survives. The historical text is preserved below.

RMR chair feedback on 2026-05-27 identified two scoring rules in M1.9 that were wrong. The 2026 season is 6 events (not 7 — a June date was lost), so the hardcoded "best 4 of 7" constant was doubly wrong: the total was off by one, and the threshold must come from the data rather than code. The chair also clarified that championship points are car-specific: only events a driver ran in their primary car count.

**Qualifying threshold:**
- `qualifyingEvents = floor(N/2) + 1` where N = count of ingested `Event` rows for the calendar year. N=6→4, N=7→4, N=8→5.
- A driver needs at least `qualifyingEvents` scoring events in their season class for an official standing; below that → Provisional.
- Only the driver's top `qualifyingEvents` scores count toward season total; the rest are rendered but visually muted (same treatment as today's "dropped" scores).

**Single-car constraint:**
- Within a driver's season-class entries, group by normalized `Entry.carDescription` only (trim, lowercase, collapse whitespace). `carNumber` is intentionally excluded because it floats per-event for drivers without permanent numbers.
- Primary car = the group with the most events. Tiebreak by highest cumulative points across events in that group; final tiebreak (extremely unlikely) by earliest event date for determinism.
- Entries in the driver's non-primary car groups are excluded from season standings entirely. They still appear in per-event leaderboards.
- Wording-drift risk accepted: `"Boxster S"` vs `"Porsche Boxster S"` would split incorrectly — a registration-data problem, not a scoring-code problem.

**Scope notes:**
- No schema change. `Entry.carNumber` (from `drivers.number`) and `Entry.carDescription` (from `drivers.car_model`) are already populated at ingest.
- No re-ingest needed. Re-running the scoring pass against the existing DB is sufficient.
- The chair confirmed 2025 official PCA Series exports did not enforce the single-car rule either, so `docs/private/compare-official.ts` will newly report mismatches for affected 2025 drivers after M1.13 lands. This is correct — not a regression. Re-run it after the change to catalog drift.

**Files changed:** `apps/web/src/lib/season-leaderboard.ts`, `apps/web/src/app/leaderboard/season-leaderboard-view.tsx`, `apps/web/src/app/leaderboard/page.tsx`, `apps/web/src/app/leaderboard/[year]/page.tsx`, `apps/web/tests/season-leaderboard.test.ts`, `apps/web/tests/driver-history.test.ts`, `apps/web/tests/fixtures/build-multi-event-season.mjs`.

### M1.14 — Multi-class / multi-car season scoring ✓ (done 2026-06-08)

AX chair update on 2026-06-08 reversed the single-car-per-season constraint introduced in M1.13. Drivers may now score points in multiple cars (across multiple classes) within a season. The dynamic qualifying threshold from M1.13 is retained unchanged.

**New scoring rules (RMR PCA 2026 — region-specific):**

- A driver appears in **every class** they entered. The single-season-class picker from M1.9 (and the primary-car picker from M1.13) are both removed.
- For each `(driver, class)` pair, **all entries score** regardless of car. A driver who switches between a Boxster and a Cayman within CS gets points from both.
- Per-class eligibility is computed independently: a `(driver, class)` row is **Official** when its scoring-event count `≥ qualifyingEvents` and **Provisional** otherwise. The Provisional badge already renders as `Provisional · N/threshold`.
- "A driver can only win in a single class" (chair's wording) is enforced by arithmetic, not by code: the threshold is `floor(N/2) + 1`, strictly greater than `N/2`. Two times the threshold exceeds N, so no driver can clear the bar in two classes within a single season. Documented at the `qualifyingEventCount` helper.

**Implementation notes:**

- `apps/web/src/lib/season-leaderboard.ts` re-keys raw scores by `${driverId}|${classCode}` (composite). Three internal helpers were deleted: `normalizeCarKey`, the season-class derivation block, and the primary-car derivation block. The `SeasonStandingsRow.primaryCar` field is removed (it would have been ambiguous under multi-car) — no UI surface relied on it beyond the per-row caption display.
- `apps/web/src/app/leaderboard/season-leaderboard-view.tsx` drops the per-row `primaryCar.carDescription` caption from `DriverCard` and `DriverTableRow`. No other UI change — the existing class-section layout already handles the same driverId appearing in two sections (the `/drivers/[id]` link still collapses to one profile).
- Per-event scoring (Step 2) is unchanged. The fastest entry in each `(event, class)` cell earns 1000; others scale relative to that. The previous code already included all entries in the per-event fastest computation; only the standings-inclusion filter at the back end of the pipeline was tightening it. Removing that filter is the entire behavior change.
- No schema or migration change. No re-ingest required.

**Test fixture (unchanged data, updated expectations):**

The synthetic 2026 fixture (6 events, 7 drivers) is unchanged on disk — only the comment block was rewritten. Standings under M1.14:

- **C1:** Alex 4000 elig, Bea 3803 elig, Dee 1744 prov, Evan 806 prov.
- **CS:** Fred 3797 elig, Gina 3766 elig, Cam 3000 prov, Dee 1967 prov, Bea 1000 prov.

Notable: Bea and Dee now appear in both C1 and CS (Bea 5/CS-1, Dee 2/2). Fred's Cayman GT4 event-3 entry that M1.13 excluded now contributes 922 pts. Gina's three Cayman events that M1.13 excluded now contribute 775/741/817 pts.

**Operational note:** `docs/private/compare-official.ts` newly reports drift in the *opposite* direction from the M1.13 transition — the official PCA Series exports from 2025 reportedly did not enforce single-car either, so the M1.14 numbers should *converge* on the official rendering for both 2025 and 2026 backfills. Re-run after deploy to catalog the new alignment.

**Files changed:** `apps/web/src/lib/season-leaderboard.ts`, `apps/web/src/app/leaderboard/season-leaderboard-view.tsx`, `apps/web/tests/season-leaderboard.test.ts`, `apps/web/tests/fixtures/build-multi-event-season.mjs`, `docs/PRD.md`, `docs/BUILD.md`.

### M2 — MSR OAuth ✓ (done 2026-05-28)

M2 ships full MSR OAuth 1.0a sign-in end-to-end: a three-legged OAuth handshake against `api.motorsportreg.com`, an encrypted session cookie persisting the user's MSR identity, a `/me` page showing `firstName lastInitial` + monospace MSR UID + RMR-membership badge, and login state reflected in the site header nav. The flow was verified against live MSR in a 2026-05-28 smoke test.

**Libraries:**
- `oauth-1.0a` (npm) + Node `crypto` for HMAC-SHA1 request signing per RFC 5849.
- `iron-session` for encrypted session cookies (App Router-native, stateless, AES-256-GCM). No NextAuth/Auth.js — v5 explicitly deprioritizes OAuth 1.0a, and a single-provider MVP doesn't earn back the dep weight or upgrade tax.

**Session shape (`apps/web/src/lib/session.ts`):** `SessionData` has six fields: `msrUid`, `firstName`, `lastInitial`, `accessToken`, `accessTokenSecret`, `isRmrMember`. Note: `profileId` from the original M2 plan was dropped — `msrUid` (the `id` field from `/rest/me.json`) is the authoritative user identifier; the speculative `tokenData["memberid"]` parsing was removed.

**Two cookies:**
- `lc_session` — 30-day sliding window, HttpOnly + Secure(prod) + SameSite=Lax. Carries the full session (MSR UID, name initials, tokens, membership flag).
- `lc_msr_req` — 10-minute cookie, scoped to `path: "/api/auth/msr/callback"`, holds only the request-token secret during the handshake. Destroyed after callback completes.

**`SESSION_SECRET`** is checked lazily via a `getSessionSecret()` helper on first use (not at module load), so `next build` runs without the secret being present in the build environment.

**Env vars (added to `apps/web/.env.example`):** `MSR_CONSUMER_KEY`, `MSR_CONSUMER_SECRET`, `MSR_RMR_ORG_ID`, `MSR_OAUTH_CALLBACK_URL`, `SESSION_SECRET`. `MSR_OAUTH_CALLBACK_URL` is a static per-Vercel-environment env var (not derived from request `Host` at runtime as the original plan considered) — MSR accepts any URL passed via `oauth_callback`, so per-deploy config works fine without a server-side allowlist. The callback route throws if `MSR_RMR_ORG_ID` is unset (no fallback).

**Endpoints centralized in `apps/web/src/lib/msr-endpoints.ts`:** `MSR_REQUEST_TOKEN_URL`, `MSR_ACCESS_TOKEN_URL`, `MSR_ME_URL` (note `.json` extension required — MSR ignores `Accept` headers), `MSR_AUTHORIZE_URL_BASE`.

**Signing helpers in `apps/web/src/lib/msr.ts`:** lazy-singleton OAuth client; `signRequest()` (OAuth protocol params flow through the `data` field so they land in both the signature base string and the `Authorization` header); `parseFormEncoded()`; and `signedMsrFetch<T = MsrMeResponse>()`.

**Three-legged flow routes (Node runtime):**

1. `GET /api/auth/msr/login` — POST `/rest/tokens/request` → stash secret in `lc_msr_req` → 302 to `${MSR_AUTHORIZE_URL_BASE}?oauth_token=…`.
2. `GET /api/auth/msr/callback` — read `oauth_token` + `oauth_verifier` → read+destroy `lc_msr_req` → POST `/rest/tokens/access` (verifier via `data`) → GET `/rest/me.json` → redact `lastName` via `redactLastName()` from `@/lib/ingest` → compute `isRmrMember = profile.organizations.some(o => o.id === MSR_RMR_ORG_ID)` → persist session → 302 to `/me`.
3. `POST /api/auth/logout` — destroy session → 302 to `/` (POST-only to avoid CSRF-style prefetch).

**Error redirects from callback:** no `oauth_verifier` or missing `lc_msr_req` → `/login?error=denied`; `/rest/tokens/access` non-2xx → `/login?error=token-exchange`; `/rest/me.json` fetch fails → `/login?error=profile-fetch`.

**`/rest/me.json` shape pinned as `MsrMeResponse` in `apps/web/src/lib/msr.ts`:** double-wrapped `{ response: { profile: { id, firstName, lastName, email, avatar, organizations: [{ id, memberId, name }] } } }`. `id` and `organizations[].id` are uppercase-hex UUIDs with dashes.

**Pages:**
- `/login` — public; renders an error message from `?error=`; "Sign in with MotorsportReg" is a `<Link>` to `/api/auth/msr/login`.
- `/me` — server component; redirects to `/login` if `msrUid` is missing; renders `firstName lastInitial` + monospace MSR UID + RMR-membership badge + logout form.

**Header nav (`apps/web/src/components/header-nav.tsx`):** server component reading `getSession()`; signed-in users see their display name as a `<Link>` to `/me`; signed-out users see a "Sign in" link. Integrated into `apps/web/src/app/layout.tsx`.

**Probe script (`apps/web/scripts/msr-oauth-probe.ts`):** manual one-shot tool that runs the full three-legged flow against live MSR and writes the raw `/rest/me.json` to `docs/private/rest_me_sample.json` (gitignored — contains PII). Not wired into CI. Run via `pnpm --filter web tsx --env-file=.env scripts/msr-oauth-probe.ts`.

**Signing tests (`apps/web/tests/msr-signing.test.ts`):** pin HMAC-SHA1 signatures deterministically by injecting fixed `oauth_timestamp` and `oauth_nonce`, with snapshot tests for both `/rest/tokens/request` (no token, with `oauth_callback`) and `/rest/tokens/access` (request token + `oauth_verifier`) Authorization headers, plus round-trip coverage for `parseFormEncoded()`. Snapshots committed under `apps/web/tests/__snapshots__/`.

**Security:**
- OAuth's `oauth_token` query param on the callback is bound to the cookie-stored `oauth_token_secret` (callback authenticity without a separate CSRF token).
- All cookies HttpOnly + Secure(prod) + SameSite=Lax.
- `MSR_CONSUMER_SECRET` and `SESSION_SECRET` live only in env, never logged, never sent to the client.
- Full last name is used transiently for `redactLastName()` and never persisted to the session.

**Resolved during M2:**
- **Callback URL pre-registration with MSR?** No — MSR accepts any URL passed via `oauth_callback`. Confirmed during the 2026-05-28 sign-in smoke test.
- **Access-token lifetime / revocation behaviour?** Still unknown — no expiry observed during M2 testing. Future work: on a `signedMsrFetch` 401 in any authenticated route, clear the session and redirect to `/login?error=session-expired`. Not implemented in M2; sessions effectively last for the 30-day cookie sliding window.
- **Exact `/rest/me.json` shape?** Confirmed and pinned in TS as `MsrMeResponse` (see above).
- **Sign-in policy: require RMR membership?** **No — record only.** `isRmrMember` is stored on the session for UI affordances but does not gate sign-in. Admin features gate via the existing env-backed allowlist (`ADMIN_MSR_UIDS`). Push to future scope when the app expands beyond a single club.

**Definition of Done met:** signed-in user lands on `/me` after a real OAuth handshake against live MSR; session cookie roundtrips and survives page refresh; logout clears it and subsequent `/me` hits redirect to `/login`; secrets never appear in DB, logs, or client payloads. (Non-RMR-member smoke deferred — only RMR-member accounts tested in this session.)

### M2.1 — RMR-only gate ✓ (done 2026-05-29)

**What landed:** `/` branches on session state — RMR members see the events-home view, everyone else sees the `Landing` component. A `requireRmrMember(returnPath?)` page-level gate covers the four detail/list routes (`/events/[slug]`, `/leaderboard`, `/leaderboard/[year]`, `/drivers/[id]`). The header nav hides Events and Leaderboard links for non-members. `returnTo` deep-link round-trip is wired through the existing transient `lc_msr_req` cookie. 18 vitest cases cover `sanitizeReturnTo`.

**Helpers added to `apps/web/src/lib/session.ts`:**
- `sanitizeReturnTo(raw): string | null` — strict open-redirect validator (6 rules + percent-encoded control-char check, see Gotcha 5).
- `requireRmrMember(returnPath?)` — page-level gate; throws `redirect()` to `/?returnTo=<encoded>` when the caller isn't an RMR member.

**Files changed (12 total):**
- Modified: `apps/web/src/app/api/auth/msr/callback/route.ts`, `apps/web/src/app/api/auth/msr/login/route.ts`, `apps/web/src/app/drivers/[id]/page.tsx`, `apps/web/src/app/events/[slug]/page.tsx`, `apps/web/src/app/leaderboard/[year]/page.tsx`, `apps/web/src/app/leaderboard/page.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/components/header-nav.tsx`, `apps/web/src/lib/session.ts`
- New: `apps/web/src/app/_events-home.tsx`, `apps/web/src/components/landing.tsx`, `apps/web/tests/return-to.test.ts`

**Gotchas:**

1. **Never wrap `requireRmrMember` in `try/catch`** — `redirect()` throws `NEXT_REDIRECT`; swallowing it produces a blank page. Callers MUST let the throw propagate.
2. **Gate runs before `notFound()` on dynamic routes** (`/events/[slug]`, `/leaderboard/[year]`, `/drivers/[id]`). Otherwise unauth viewers can distinguish valid from invalid slugs/ids by 404-vs-redirect timing.
3. **`lc_msr_req` cookie path-scoping is about send, not set.** The cookie is created by `/api/auth/msr/login` and stored with `path=/api/auth/msr/callback`. The browser only sends it back to URLs matching that path — `Set-Cookie` from any origin path is honored. Adding `returnTo` to its payload changes nothing about the transport.
4. **`returnTo` is silently dropped for non-RMR users in the callback.** Otherwise the callback redirects to (say) `/leaderboard`, the gate immediately bounces back to `/?returnTo=...`, and the user sees a flicker. Deliberate trade-off — non-RMR users always land on `/` after sign-in.
5. **`sanitizeReturnTo` rejects percent-encoded control chars (`%00–%1f`, `%7f`) in addition to raw control chars.** The Node `URL` constructor keeps percent-encoded controls encoded in `pathname` rather than decoding them, so a raw `[\x00-\x1f\x7f]` regex alone misses `/path%0d%0aSet-Cookie:x`. The second regex (`/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i`) closes that gap.

### M4 — Admin upload ✓ (done 2026-05-28)

M4 adds a browser-based `.axdb` upload workflow for admins, so the timing chief can publish post-event results without shell access. The same `ingestAxdb()` module from M1 is reused — the only new code is the authorization layer, the upload validation helper, the admin UI, and the API route.

**Authorization model:**

- `ADMIN_MSR_UIDS` — a comma-separated env var listing the MSR UIDs of admins. No default, no fallback; if unset, no one is admin and `/admin` returns 404 for everyone. Set in Vercel env per deployment environment by the operator.
- `isAdmin(msrUid)` in `apps/web/src/lib/admin.ts` — pure function, reads env per-call. Returns `false` for any falsy UID or missing/empty env var.
- `/admin/layout.tsx` calls `notFound()` for non-admins — 404 rather than 403 so the route's existence is not disclosed to logged-in non-admins. Layout-level gate covers `/admin`, `/admin/ingest`, and any future `/admin/*` pages.
- `POST /api/admin/ingest` independently re-checks session (401) and `isAdmin()` (403). Defense in depth — the route is independently reachable without the UI.

**Upload validation (`apps/web/src/lib/axdb-validate.ts`):**

Three layers before `ingestAxdb()` touches the data:
1. **Size cap** — 413 if `file.size > 4 MB`. Fits under Vercel Hobby's 4.5 MB body limit; observed RMR `.axdb` files are well under 1 MB.
2. **Magic header** — first 16 bytes must equal `"SQLite format 3\0"`. Cheap check; short-circuits without writing to disk.
3. **`PRAGMA quick_check`** — write to `os.tmpdir()/axdb-{uuid}.axdb`, open read-only with `better-sqlite3`, run `PRAGMA quick_check`. If not `"ok"`, unlink and return `{ ok: false }`. If ok, return `{ ok: true, tempPath }` for the caller to hand directly to `ingestAxdb()`.

`ingestAxdb()` then applies its own structural checks (required tables, single-event guard, disposition validation) before any DB write.

**Temp-file lifecycle:** the buffer is written to `os.tmpdir()` for the `quick_check` and passed to `ingestAxdb()`. The route handler unlinks it in `finally` regardless of success or failure.

**API route (`apps/web/src/app/api/admin/ingest/route.ts`):**

Validation pipeline in order: session present → admin allowlist → parse FormData → size cap → `.axdb` extension hint → buffer + validate → ingest → cleanup → audit log → 200 JSON. Ingest errors surface as 422 with the error message.

`export const runtime = "nodejs"` — `better-sqlite3` requires native bindings; Edge runtime is not supported.

Audit log: `console.log({ event: "admin-ingest", admin: msrUid, status, slug, counts })`. ~~Persistent `Ingest` table is deferred to post-MVP.~~ Superseded in M4.1: successful ingests (browser and CLI) now also write a persistent `AdminAuditLog` row.

**Admin UI:**

- `/admin` — landing page with a card linking to `/admin/ingest`. Room for future admin cards.
- `/admin/ingest` — server component rendering the client `UploadForm`.
- `UploadForm` (`"use client"`) — file input + upload button. Three states: `idle | uploading | done`. Success: event name (linked to `/events/[slug]`), slug, four counts, and a "Re-uploaded — no changes" badge when `status === "unchanged"`. Error: inline error message. Uses only existing shadcn components (`button`, `input`, `card`, `badge`).

**Header nav:** `isAdmin()` checked in `HeaderNav` (server component); "Admin" link rendered between "Leaderboard" and the user display name only when the session UID is allowlisted.

**Env vars added to `.env.example`:** `ADMIN_MSR_UIDS=` with a comment on the comma-separated format.

**Files added:**
- `apps/web/src/lib/admin.ts`
- `apps/web/src/lib/axdb-validate.ts`
- `apps/web/src/app/admin/layout.tsx`
- `apps/web/src/app/admin/page.tsx`
- `apps/web/src/app/admin/ingest/page.tsx`
- `apps/web/src/app/admin/ingest/upload-form.tsx`
- `apps/web/src/app/api/admin/ingest/route.ts`
- `apps/web/tests/admin.test.ts`
- `apps/web/tests/axdb-validate.test.ts`

**Security posture:**
- Admins are trusted users (per PRD §1.3), so no CSRF tokens or rate limiting in MVP. Uploaded *content* is treated as untrusted — three validation layers before any DB write.
- No persistence of the uploaded buffer beyond the `os.tmpdir()` file deleted in `finally`. Driver last names (PII) transit memory only and are redacted by `ingestAxdb()` before any DB write.
- `ADMIN_MSR_UIDS` is env-only, no hardcoded fallback. If unset, no one is admin.

**Out of scope for M4 (future):** persistent audit table (landed in M4.1), rate limiting, chunked/resumable uploads for files >4 MB, background-worker hand-off.

### M4.1 — Admin event management ✓ (done 2026-07-10)

Closes the "hand-edit the DB to fix bad uploads" gap. An admin uploaded 2024/2025 `.axdb` files with bad metadata; because ingest keys events by `slug = ${event_date}-${slugify(event_name)}`, re-uploading a corrected file minted a **new** Event and left the stale one in place. Since season pages derive year from `Event.date`, one misdated event pollutes the season switcher, shifts the dynamic qualifying threshold (`floor(N/2)+1`), and skews standings.

**What landed:**

- **`/admin/events`** — server-rendered event list (name, date, slug, entry/run/video counts, createdAt) with per-row Edit and Delete dialog actions. Covered by the existing `/admin/layout.tsx` gate; new card on the `/admin` hub.
- **Edit metadata** (`PATCH /api/admin/events/:id`) — name/date/location edited in place. Changing name or date regenerates the slug via `buildEventSlug()` (exported from `src/lib/ingest.ts` so ingest and admin-edit can never drift). Editing into another event's slug returns 409 with an inline dialog error; a Prisma `P2002` catch backstops the check-then-update race.
- **Guarded delete** (`DELETE /api/admin/events/:id`) — confirmation dialog shows exactly what goes ("N entries, M runs, K videos"; no type-to-confirm — deletes are recoverable by re-uploading the `.axdb`). `Event` delete cascades `Entry` → `Run` and `Video`; the same interactive transaction then sweeps `Driver` rows with no remaining entries **and** no videos. The sweep is global by design (also cleans pre-existing orphans); `Driver`/`CarClass` are shared across events and otherwise untouched.
- **`AdminAuditLog`** (migration `20260710213325_admin_audit_log`) — one generic table for `ingest` / `event.update` / `event.delete` with actor MSR UID + redacted display name (`First L.` only), target id/slug, and a JSON-string `detail` column (before/after for edits, counts + `orphanDriversDeleted` for deletes, filename + sha + counts for ingests). Edit/delete write the audit row inside their transaction; the two ingest paths (admin upload route, CLI with `actor: "cli"`) write best-effort in a try/catch so an audit hiccup never fails a completed ingest.
- `IngestSummary` gained `axdbSha256` (ingest already computed it) so audit writers don't recompute.
- Added the shadcn `dialog` primitive (base-nova / Base UI — no new npm dependency).

**Decisions:** API routes rather than server actions (consistent with the codebase's only mutation idiom); a single `/admin/events` page with row actions rather than per-event pages; orphan sweep automatic inside the delete transaction rather than a separate button; one generic audit model rather than a separate `IngestLog`.

**Files:** new `src/lib/admin-events.ts` (`updateEventMetadata`, `deleteEventWithSweep`, typed `EventNotFoundError`/`SlugCollisionError`), `src/lib/audit.ts` (`writeAudit`), `src/app/api/admin/events/[id]/route.ts`, `src/app/admin/events/` (page + table + two dialogs), `src/components/ui/dialog.tsx`; modified `src/lib/ingest.ts`, both ingest entry points, `/admin` hub, `prisma/schema.prisma`.

**Tests:** `tests/admin-events.test.ts` (13 cases, isolated `test-admin-events.db`): delete cascade, orphan sweep with cross-event shared drivers, video-guard (driver whose only remaining footprint is a video on a surviving event survives), audit-row PII sweep, slug regen/ingest-convention parity, location-only edit stability, collision atomicity (no partial write, no audit row), not-found, and a regression test that delete + re-ingest lands on exactly one Event row.

**Verified end-to-end (2026-07-10):** reproduced the duplicate with a date/name-tweaked synthetic fixture, then fixed it entirely through the UI — edit with slug regen, inline 409 on collision, both deletes (second sweep removed all 6 synthetic drivers), deleted slug 404s, home/leaderboard recovered. Checked at mobile (390px — table scrolls in its own `overflow-x-auto` container) and desktop breakpoints.

**Deploy note:** the Turso migration is applied manually by the operator (`pnpm --filter web migrate:turso`) — delete/edit fail against Turso until it's applied because the audit insert is part of the transaction.

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
| 1 | MSR OAuth credentials. | Received 2026-05-27; verified working end-to-end via M2 sign-in flow on 2026-05-28. Stored in Vercel env as `MSR_CONSUMER_KEY` / `MSR_CONSUMER_SECRET`. | 2026-05-28 | M2 ✓ |
| 2 | RMR's MSR organization ID. | Received 2026-05-27; verified working in the M2 callback's `isRmrMember` computation on 2026-05-28. Stored in env as `MSR_RMR_ORG_ID`. | 2026-05-28 | M2 ✓ |
| 4 | Vercel free tier OK for MVP? Custom domain plan? | Turso (libSQL) is the hosted DB; Vercel hosts the app on the free tier. Custom domain `launchcontrol.club` registered and attached. | 2026-05-19 | M1.5b |
| 7 | Drivers without `member_num` produce duplicate rows under redaction. Acceptable for MVP? | Identity-hash strategy dedupes drivers without `member_num` by name; residual cross-event name-collision risk accepted for MVP. | 2026-05-23 | M1.10 |
| 8 | 2025 historical `.axdb` files — do we have all 7 events on hand? | Deferred from M1.9. Navigation/season-switcher shape still built so 2025 can slot in later when the data is available. | 2026-05-21 | M1.9 |
| 9 | SmugMug multi-club generalization. | Deferred to post-MVP. M1.8's single-tenant env-var config is sufficient for RMR-only MVP; promote to per-club entity when a second club adopts the platform. | 2026-05-27 | Future scope |
| 10 | Same-driver, same-class, same-event co-drives — score both `Entry` rows independently or collapse to better score? | VisualAX uses separate `drivers` rows for co-drives (`337` + `337X`, `62` + `162`); each scores independently. Driver identity is the identity hash (not `member_num` — a co-drive pair sharing `member_num` was observed in 2025-09-13 real data). Ingest throws on the truly pathological "same human, same class, both with runs" case. | 2026-05-23 | M1.10 |
| 11 | `bestcommittedrun_id` semantics — authoritative override, UI cache, or one-off bug? | Chair confirmed authoritative; honor when present. 2025-08-16 case traces to an VisualAX bug fixed 2025-09-23. Status values 0–4 enumerated; only `3=committed` should be ingested. `OFF`/`DSQ` dispositions exist and must be excluded from best-time. | 2026-05-26 | M1.12 |
| 12 | Multi-event `.axdb` support. | VisualAX format permits multiple events per file (unused by RMR). Ingest enforces single-event with a fail-loud guard; full multi-event support deferred to post-MVP if a region adopts the season-points feature. | 2026-05-27 | post-M1.12 |
| 13 | Season qualifying threshold and single-car-per-season rule. | Threshold dynamic per season: `floor(N/2) + 1` (above 51%). Qualifying scores must all be in one car (primary = most events, tiebreak by cumulative points). Chair confirmed prior season PCA Series exports did not enforce the single-car rule. Car key is normalized `carDescription` only (numbers float per-event for non-permanent-number drivers). | 2026-05-27 | M1.13 |
| 14 | M2 open implementation questions. | Callback URL not pre-registered with MSR (accepts any `oauth_callback`); `/rest/me.json` shape pinned as `MsrMeResponse`; sign-in policy is record-only (no RMR-gate, admin via `ADMIN_MSR_UIDS`); token revocation behaviour still untested. See M2 section for details. | 2026-05-28 | M2 |
| 15 | Admin allowlist: which MSR UIDs bootstrap as admin? | `ADMIN_MSR_UIDS` env var (comma-separated). Set in Vercel env per deployment environment; no default, no fallback — if unset, no one is admin. The timing chief's UID is added to the Vercel preview and prod env vars by the operator after M4 deploys. | 2026-05-28 | M4 |
| 16 | Single-car-per-season rule (M1.13) — keep or reverse? | Reversed per AX chair 2026-06-08. Drivers may now score points in multiple cars across multiple classes within a season. The dynamic qualifying threshold (`floor(N/2) + 1`) is retained, computed per `(driver, class)` pair. "A driver can only win one class" is enforced by arithmetic (2 × threshold > N), not by code. | 2026-06-08 | M1.14 |

---

## Appendix · Post-MVP Deployment Hardening

Out of scope for the MVP but noted to keep prior thinking discoverable:

- **Containerization** (Docker / `docker-compose`) for parity between dev, preview, and prod.
- **Background ingestion worker** if `.axdb` uploads outgrow Vercel function limits.
- **Revisit the `better-sqlite3` dependency.** `apps/web/src/lib/axdb-validate.ts` and `apps/web/src/lib/ingest.ts` both import `better-sqlite3` to read user-uploaded `.axdb` SQLite files. It is a native N-API addon (statically links SQLite C) and has caused real friction:
  - Every install needs either a `prebuild-install` binary matching `<node-abi>-<platform>-<arch>` or a fresh `node-gyp` compile (Python + clang). Node 24 / ABI v137 on darwin-arm64 may not have a published prebuild yet, forcing source builds.
  - `node-gyp` detects macOS Command Line Tools via `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables` — not `xcode-select -p`. If the receipt is missing (CLT installed by a non-pkg path), the build aborts with "No Xcode or CLT version detected!" even though the toolchain is on disk.
  - Vercel-vs-CI strictness drift hit us on 2026-06-03: a malformed `pnpm-lock.yaml` from Dependabot passed Vercel's default `pnpm install` (regenerates lockfile in build sandbox) but broke GH Actions' `pnpm install --frozen-lockfile`. See `feedback_dependabot_lockfile_duplicate_keys` memory; consider setting Vercel's install command to `pnpm install --frozen-lockfile` so prod and CI fail together.
  - **Candidate replacements** (dig in later — picking depends on confirming the runtime Node patch version on Vercel and CI):
    - **`node:sqlite`** (built into Node ≥ 22.5; stable without flag in recent 22.x patch releases and Node 24). Zero install, no compile, sync API in the same shape as `better-sqlite3` — mechanical diff in the two consumer files. Strongest candidate.
    - **`sql.js`** (SQLite compiled to WASM). Truly no native, runs anywhere Node runs. Tradeoffs: async + whole-file-into-memory + ~2–3× slower than native. Irrelevant for `.axdb` sizes; would require restructuring sync code to async.
    - **`@libsql/client`** (already in deps via the Prisma adapter for Turso). Supports `file:` URLs for local SQLite — but is still native underneath (platform-specific prebuilds) and async-only, so it swaps one native dep for another and forces an async refactor. Lowest payoff.

---

## Outstanding Review Feedback

- [ ] Use the /identifier-naming skill on that PRD just to double-check the names of tables, variables, etc.
- [x] Prisma has great DX, but if things get complex with queries you might prefer Drizzle ORM
- [x] If using SQLite, the Turso library is great to have local/remote duality
- [x] For OAuth (or authentication in general), I recommend Better Auth, so you don't have to build your own auth manually
- [x] For Calendars and scheduling you can use cal.com (they have an open source version)
- [x] VisualAX author review of PRD (2026-05-27) — clarifications on co-driver numbering, multi-event `.axdb` format, `unique_numbers` / `paxed_class` fields, and excessive-run handling; incorporated into BUILD.md.
