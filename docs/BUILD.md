# PCA Launch Control — Build Reference

Implementation reference and build history for [Launch Control](https://launchcontrol.club). Companion to [PRD.md](./PRD.md), which holds requirements.

---

## Current Status

**Status (2026-08-25):** M0 ✓ · M1 ✓ · M1.5a ✓ · M1.5b ✓ · M1.6 ✓ · M1.7 ✓ · M1.8 ✓ · M1.9 ✓ · M1.10 ✓ · M1.11 ✓ · M1.12 ✓ · M1.13 ✓ · M1.14 ✓ · M1.15 ✓ · M1.16 ✓ · M1.17 ✓ · M2 ✓ · M2.1 ✓ · M4 ✓ · M4.1 ✓ · League Foundation ✓ — public preview is live at [launchcontrol.club](https://launchcontrol.club) (Vercel + Turso libSQL), with last-name redaction, racing-red styled UI, GitHub Actions CI (lint/typecheck/test/build on every PR), a per-driver progression page (`/drivers/[id]`) charting raw/PAX/best-of progression and time-delta vs. event leader across the season, SmugMug photo album links surfaced on home + event pages, the RMR season points leaderboard at `/leaderboard` (top-K-of-N where K is the dynamic qualifying threshold, per-class standings, multi-season nav, multi-class & multi-car participation as of M1.14, same-date events auto-grouped into one combined scoring event with a dedicated `/events/combined/[date]` standings page as of M1.15, mid-season threshold now derived against the planned season size rather than only events ingested so far, with a provisional-standings banner, as of M1.16), an ingest correctness pass — batched writes, identity-hash driver dedupe, ghost-registration skip — plus the dynamic qualifying threshold from M1.13. Members can now sign in with their MotorsportReg account via the header nav and view `/me`, which shows their MSR identity and an RMR-membership badge. Event data and leaderboards (event list, event detail, season standings, driver profiles) are now restricted to MSR-authenticated RMR members; unauth and non-RMR visitors see a landing page at `/` and deep links survive sign-in via a sanitized `returnTo` round-trip. Admins can upload `.axdb` files from the browser at `/admin/ingest` — no shell access required — and manage ingested events at `/admin/events`: edit name/date/location (the URL slug regenerates), or delete a bad/duplicate event with full cascade and an orphan-driver sweep, with every admin ingest/edit/delete recorded in a persistent `AdminAuditLog`. As of 2026-08-25 each league can also publish a **vehicle classing guide** — a public, ungated `/l/[league]/classing` page (legacy alias `/classing`) with a "find my class" picker over the season's model/year/trim, plus hover cards on every class badge in the results tables. **Next up:** M3 — Public calendar (RMR event calendar from /rest/calendars/organization/{org_id}).

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

The "SQLite app DB" above is **SQLite locally** and **Turso (libSQL) in preview/prod** — same SQL dialect, swapped at the Prisma driver-adapter layer. See "Database Hosting" below for rationale. This is the Vercel-hosted production topology; no Nginx or Tailscale there. A self-hosted alternative (Docker Compose, plain SQLite volume, optional RMsolo ingest sidecar) also exists as of PR 2 — see "League Multi-Club (PR 2)" below and the Appendix.

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
- **2024 AxWare→VisualAX transition artifacts.** Two 2024 exports have `member_num` blank for every driver, which would otherwise split each human into a separate `Driver` row per event. Ingest handles this natively: `Driver.nameOnlyHash` (full-name-only key) lets a blank-`member_num` row merge into the single existing populated `Driver` sharing its name, and lets a later populated row "adopt" a pre-existing blank row the same way — both only when exactly one candidate exists (see "Driver identity hash" in `AGENTS.md`). Ingesting chronologically (oldest event first) maximizes merge confidence, since resolution only sees data ingested so far. For admins who want to repair the `.axdb` files themselves rather than rely on ingest-time merging, `apps/web/scripts/repair-axdb-identity.ts` remains available — it cross-references other exports by full name and writes backfilled copies to an `--out-dir` without touching originals. Separately, `member_num` sometimes drifts across exports for the same person by a `verified` suffix (`N` / `N verified` / `N-verified`); ingest strips this via `normalizeMemberNum()` (see Driver identity below) so it never causes a split identity. Some pre-2025 exports also lack the `events.timing_mode` / `typical_time` columns entirely — harmless, since ingest never reads them.

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
  sourceSha256 String?                    // dedupe re-ingests of the same source artifact (renamed from axdbSha256 in League Foundation)
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

**`Video` is schema-only.** The table has existed since the init migration (20260518214917) as groundwork for the future M5 media hub (driver-submitted YouTube/Vimeo links — see PRD Future Scope), but **no write path exists yet** and no rows exist in any environment. The M4.1 admin surface already handles it correctly: event delete cascades videos, the delete dialog shows the video count, and the orphan-driver sweep keeps drivers whose only remaining footprint is a video on a surviving event.

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
| `/l/[league]/classing`               | `table` · `badge` · `select` · `hover-card`                |

Dark mode is in scope for M0 (Tailwind `class` strategy + a small theme toggle).

### Ingestion Strategy

Library: **`better-sqlite3`** (synchronous, fast, no async overhead). Since v13 it is an N-API addon that ships prebuilt binaries in the published tarball, so it needs no install script and no local compile on macOS/Linux dev machines — see the appendix note on this dependency.

- **M1 (local CLI):** `pnpm ingest <path-to-axdb>` opens the source with `new Database(path, { readonly: true })`, reads `events` / `classes` / `drivers` / `registrations` / `runs`, and upserts into Prisma inside a single transaction. Idempotent on re-run (keyed by `(eventId, driverId)` and `(entryId, runNumber)`).

**Single-event assumption:** ingest reads exactly one `events` row from the source file and throws a clear error if the source contains more than one. The `.axdb` format permits multi-event files (VisualAX's season-points feature) but RMR has never used it; the guard prevents silent partial ingest if that ever changes. Full multi-event support is deferred to post-MVP.

- **M4 (admin upload):** accepts a multipart `.axdb`, writes it to a tmp file, and runs the same code path. **Vercel constraint:** the function must use the Node.js runtime (`export const runtime = "nodejs"`, not Edge) and may need a higher memory tier — `better-sqlite3` loads a native binary, which Edge cannot do. It does **not** pin a particular Node major: since v13 the addon is N-API/ABI-stable, so the same `linux-x64` prebuild works across Node versions (CI runs Node 22).

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

**Driver identity (M1.10):** ingest computes `identityHash = SHA256(${memberNum ?? ''}|${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()})` and uses it as the cross-event upsert key. `memberNum` is normalized via `normalizeMemberNum()` — a trailing `verified` suffix (`N verified` / `N-verified`, any case) is stripped — before it ever reaches the hash or gets stored, so that suffix drift across exports doesn't split one person into multiple `Driver` rows. This keeps family members on a shared `member_num` as distinct `Driver` rows while still cross-linking the same human across events. Drivers without a `member_num` are deduplicated by name alone — residual risk of two unrelated people with identical first+last names colliding is small at PCA RMR scale and accepted for MVP. The full last name is used only to compute the hash; nothing beyond the redacted `lastInitial` is ever persisted.

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

- `src/lib/ingest.ts` — reusable ingest module (read-only `better-sqlite3` against VisualAX source, normalize into Prisma in a single transaction, idempotent via `Event.sourceSha256`, renamed from `axdbSha256` in League Foundation).
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
- All other drivers in the class earn `points = round(1000 * fastest_class_time / driver_best_time)` — the default `ratio1000`/`class` points system (ScoringPolicy v4's `points` field, `src/lib/event-points.ts`). A ruleset may instead score event-wide (`basis: "event"` — one PAX-relative score per driver per event, reused across that driver's class and PAX sections, RMsolo's rule) or by a finish-position table (`type: "position"`, competition ranking on ties). Ties for fastest → all tied drivers earn 1000, for either ratio system.
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

**Historical 2025 ingest:** the existing `pnpm ingest <path-to-axdb>` CLI handles 2025 files unchanged — `Event.sourceSha256` (renamed from `axdbSha256` in League Foundation) keeps re-ingests idempotent.

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
- **`apps/web/scripts/wipe-db.ts` (`pnpm --filter web db:wipe`)** — drops every table/view/trigger/index in the target DB (local `file:` or Turso libSQL) but **does not delete the database itself**. Rationale: a full Turso "destroy + recreate" rotates the DB URL + auth token, which would require updating Vercel env vars on preview and prod on every re-ingest cycle. Safety rails: prints the redacted target URL and an itemized drop plan; supports `--dry-run`; for Turso, requires typing the exact hostname to confirm; for local DBs, defaults to a `[y/N]` prompt unless `--yes` is passed.

### M1.12 — Honor `bestcommittedrun_id` + tighten status/disposition filters ✓

Closes the CS P3/P4 anomaly surfaced during the 2025 backfill (`docs/private/ellen_bestcommittedrun_anomaly.md`). Three changes land together because all three are required to match the club's official renderings.

- **Authoritative committed-best:** `apps/web/src/lib/ingest.ts` reads `registrations.bestcommittedrun_id` (FK → `runs.id`) and resolves it to a 1-indexed position in the driver's sorted-by-id source runs, storing that in a new nullable `Entry.bestCommittedRunNumber`. VisualAX's sibling `bestcommittedrun_no` is unreliable for this lookup because it skips voided RRN slots while our `Run.runNumber` numbers them sequentially — the FK is the only stable reference. A new `apps/web/src/lib/entry-best.ts` exports `bestCorrectedMsForEntry()`, which prefers that pointer and falls back to fastest CLEAN cone-corrected. `leaderboard.ts`, `driver-history.ts`, `season-leaderboard.ts` all route through the helper.
- **Status filter at ingest:** the source `runs` SELECT adds `WHERE status = 3`. Rows in queue/cancelled states (0/1/2/4) never reach the app DB. Confirmed defense-in-depth — all observed real-event exports already had status=3 only, but the chair confirmed the lifecycle semantics on 2026-05-26.
- **`OFF` / `DSQ` dispositions:** `RunDisposition` enum extended; `toDisposition()` recognizes them and now **throws** on any unrecognized string (replaces today's silent fallback to CLEAN — the exact class of bug this milestone closes). OFF/DSQ runs persist for auditing but are excluded from best-time.

Backfill: wipe local + Turso schema via `pnpm --filter web db:wipe`, re-migrate, bulk re-ingest 2025+2026 via `apps/web/scripts/ingest.sh`. Verify Ellen G. → CS P4 (2894) and Mike P. → CS P3 (2908) on `/leaderboard/2025`. Verify `docs/private/compare-official.ts` reports `Total mismatches: 0`.

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

**Probe script (`apps/web/scripts/msr-oauth-probe.ts`):** manual one-shot tool that runs the full three-legged flow against live MSR and writes the raw `/rest/me.json` to `docs/private/rest_me_sample.json` (gitignored — contains PII). Not wired into CI. Run via `pnpm --filter web msr:probe`.

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
- `IngestSummary` gained `sourceSha256` (renamed from `axdbSha256` in League Foundation; ingest already computed it) so audit writers don't recompute.
- Added the shadcn `dialog` primitive (base-nova / Base UI — no new npm dependency).
- **`/admin/audit`** (follow-up in the same PR) — read-only server-rendered page behind the same admin gate listing the latest 200 audit rows (timestamp, action, redacted actor, target slug) with per-row expandable pretty-printed detail JSON. Third card on the `/admin` hub.
- **Delete result stays visible** (follow-up in the same PR): the delete dialog switches to a persistent success state showing entries/runs/videos removed and orphaned drivers swept, closing only when dismissed; the table refreshes behind the open dialog.

**Decisions:** API routes rather than server actions (consistent with the codebase's only mutation idiom); a single `/admin/events` page with row actions rather than per-event pages; orphan sweep automatic inside the delete transaction rather than a separate button; one generic audit model rather than a separate `IngestLog`.

**Files:** new `src/lib/admin-events.ts` (`updateEventMetadata`, `deleteEventWithSweep`, typed `EventNotFoundError`/`SlugCollisionError`), `src/lib/audit.ts` (`writeAudit`), `src/app/api/admin/events/[id]/route.ts`, `src/app/admin/events/` (page + table + two dialogs), `src/components/ui/dialog.tsx`; modified `src/lib/ingest.ts`, both ingest entry points, `/admin` hub, `prisma/schema.prisma`.

**Tests:** `tests/admin-events.test.ts` (13 cases, isolated `test-admin-events.db`): delete cascade, orphan sweep with cross-event shared drivers, video-guard (driver whose only remaining footprint is a video on a surviving event survives), audit-row PII sweep, slug regen/ingest-convention parity, location-only edit stability, collision atomicity (no partial write, no audit row), not-found, and a regression test that delete + re-ingest lands on exactly one Event row.

**Verified end-to-end (2026-07-10):** reproduced the duplicate with a date/name-tweaked synthetic fixture, then fixed it entirely through the UI — edit with slug regen, inline 409 on collision, both deletes (second sweep removed all 6 synthetic drivers), deleted slug 404s, home/leaderboard recovered. Checked at mobile (390px — table scrolls in its own `overflow-x-auto` container) and desktop breakpoints.

**Deploy note:** the Turso migration is applied manually by the operator (`pnpm --filter web db:migrate`) — delete/edit fail against Turso until it's applied because the audit insert is part of the transaction.

### M1.15 — Combined same-date events ✓ (done 2026-07-18)

RMR ran 2026-07-18 as two discrete 4-run mini-events exported as separate single-event `.axdb` files sharing one calendar date ("Cone in 60 Seconds (A)" AM / "(B)" PM), scored per the club's own handout as one day: within each class, rank by summed best-corrected time across both sessions. This format will recur. Landed the minimal model: **no schema change** — the scoring group is derived at query time by grouping a season's events by UTC date key.

**Design:**

- **Auto-grouping by date:** any events sharing a calendar date form one combined scoring event, with no ingest flag or admin linking step. Verified retroactively inert — no existing season before this had two events on one date.
- **Season counting:** a combined event counts **once** toward `N` (and therefore `floor(N/2)+1`) and yields one score per `(driver, class)`.
- **Scoring:** `src/lib/season-leaderboard.ts` groups the year's events by date key into ordered *scoring groups*. A single-event group is the degenerate case (a sum of one) of the same summed-metric rule multi-event groups use, so both shapes now run through one code path. Multi-event groups: per class, a driver's summed metric = sum of `bestCorrectedMsForEntry` (PAX-indexed) across every session, **only if** they have a countable CLEAN time in **every** session **in the same class**; a class mismatch or a missing session forfeits that group entirely (fail-safe). The summed metrics are then scored through the ruleset's points system (`awardPoints` in `src/lib/event-points.ts`), with the population selected by `points.basis`: the class section's own drivers (`class`), or every driver at the event (`event`, one score per driver reused across their sections). `SeasonStandingsRow["scores"]` is re-keyed from event-keyed to scoring-group-keyed (`key`, `eventName` a combined label, `eventDate`, `points`, `dropped`, `combined: boolean`, `href`); combined chips link to the combined page.
- **Combined display label:** `combinedEventLabel()` (exported from `season-leaderboard.ts`) strips a trailing parenthesized token from each session name (`"Cone in 60 Seconds (A)"` → `"Cone in 60 Seconds"`); if every session agrees, use that, else fall back to the earliest-named session's full name.
- **`tests/season-leaderboard.test.ts` passes unchanged** — the regression proof that single-event groups are untouched by the refactor.
- **New route `/events/combined/[date]`** (`src/app/events/combined/[date]/page.tsx`, `src/lib/combined-event.ts`): static segment `combined` wins over the `[slug]` dynamic route, so no collision. `force-dynamic`, member-gated identically to `/events/[slug]`. Validates `date` as `YYYY-MM-DD`; `buildCombinedResults(events)` produces per-class + overall sections (rank, driver `First L.`, car number, vehicle, per-session best run + corrected time, Time Sum), sorted by sum ascending; non-qualifying participants (missed a session, or class-mismatched) are listed unranked below with which session they're missing. The view (`combined-table.tsx`) is a client component with the same interaction model as the per-event leaderboard — class filter chips, sortable columns (including per-session times, labeled with the session-name suffix, e.g. `(A)`/`(B)`), from-prior / from-P1 deltas, and a mobile card layout. Reuses `bestCorrectedMsForEntry` / `CONE_PENALTY_MS` — no duplicated cone math. Photos link via the existing `findSmugmugEventFolder(combinedLabel, date)`.
- **Cross-links:** `/events/[slug]` shows a banner when sibling same-date events exist, linking to the combined page. `/events` home (`_events-home.tsx`) adds a secondary `name asc` sort after `date desc` (deterministic A/B ordering — both sessions store the date at 00:00 UTC), and a "Combined event" badge + combined-standings link on every session card. `season-leaderboard-view.tsx`'s score chip and header copy adapt to the new scoring-group shape. In the same pass, `BackButton` (`src/components/back-button.tsx`) was fixed to use in-app history when `document.referrer` is empty but history entries exist (referrer stays empty across App Router soft navigations after a typed/bookmarked initial load, so it previously bounced to the fallback), and the event page's fallback changed from `/leaderboard` to `/` — a pre-existing bug surfaced while testing the combined-event flow.
- **`/drivers/[id]` left as-is** — sessions still appear as two separate history rows; not in scope for this milestone. (Addressed in M1.17.)
- **Photos:** no matching-code change needed. Both sessions share the date, so `matchEventFolder`'s date score is identical for both and they resolve to the same day's gallery; the name-token side already tolerates the `(A)`/`(B)` session suffix (verified with a new `tests/smugmug.test.ts` case).
- **Ingest:** no changes — each session file is a normal single-event ingest; distinct `event_name`s yield distinct slugs. Documented sharp edge: if two same-date files carried *identical* names, the second would upsert-overwrite the first by slug — VisualAX exports for combined events must keep the `(A)`/`(B)` suffixes. `scripts/ingest.sh`'s interactive multi-file chooser gained an **"Ingest all (combined event)"** option (files sorted lexicographically, so A before B); non-interactive mode still fails loudly, with an updated hint mentioning the new option.

**Test fixtures:** `tests/fixtures/build-multi-event-season.mjs`'s axdb-builder core (`buildEventAxdb`, schema DDL) was extracted into a shared `tests/fixtures/axdb-builder.mjs` so both it and the new `tests/fixtures/build-combined-event-season.mjs` (2 normal events + 1 same-date A/B pair ⇒ 3 scoring groups, threshold `floor(3/2)+1 = 2`) share one source of truth; existing fixtures are byte-equivalent. New `tests/combined-event.test.ts` (own test DB, mirrors `season-leaderboard.test.ts`'s setup) covers `totalEvents`/threshold, combined points math, forfeits, the combined label helper, and `buildCombinedResults` ordering/sums/unranked section.

**Files changed:** `docs/PRD.md`, `docs/BUILD.md`, `apps/web/src/lib/season-leaderboard.ts`, `apps/web/src/lib/combined-event.ts` (new), `apps/web/src/app/events/combined/[date]/page.tsx` + `combined-results-view.tsx` (new), `apps/web/src/app/events/[slug]/page.tsx`, `apps/web/src/app/_events-home.tsx`, `apps/web/src/app/leaderboard/season-leaderboard-view.tsx`, `apps/web/scripts/ingest.sh`, `apps/web/tests/fixtures/axdb-builder.mjs` (new), `apps/web/tests/fixtures/build-multi-event-season.mjs`, `apps/web/tests/fixtures/build-combined-event-season.mjs` (new), `apps/web/tests/combined-event.test.ts` (new), `apps/web/tests/smugmug.test.ts`, `apps/web/package.json` (`pretest` chain).

### M1.16 — Planned-season qualifying threshold ✓ (done 2026-07-19)

2026 is planned as a 6-event season, but the qualifying threshold was derived entirely from events already ingested (`floor(N/2)+1`, N = actual scoring groups). Mid-season, with only 3 of 6 events run, N=3 gave threshold 2 — best-2-of-3 — which silently dropped a 3-event driver's third score and let 2-event drivers outrank drivers who'd shown up more, the opposite of the intended incentive.

**Fix:** the threshold now derives from `N = max(plannedForYear, actualGroups)`, where `plannedForYear` comes from a new per-year code map, `PLANNED_SEASON_EVENTS` (`src/lib/constants.ts`) — `{ 2026: 6 }` for the MVP, counting planned scoring *dates* (a combined same-date pair is still one planned event), consistent with M1.15's group-counting. Years absent from the map fall back to the pre-M1.16 derived behavior unchanged. The formula itself, `floor(N/2)+1`, and every downstream consumer (drop-week selection, per-row eligibility, class sections) are untouched — only what `N` means changed, via a new pure helper `seasonScoringBasis(year, actualGroupCount, planned?)` that both the empty-DB early return and the main path route through.

**Result shape:** `SeasonLeaderboardResult` gains `completedEvents` (actual scoring groups ingested so far); `totalEvents` now documents that it's the season size *used for the threshold* (`max(planned, actual)`), not simply the ingested count. `/leaderboard/[year]` and `/leaderboard/season-leaderboard-view.tsx` pass `completedEvents` through unchanged otherwise.

**UI:** a new season-level banner (styled with the existing rounded-card + accent-bar idiom) reads "Standings are provisional until {qualifyingEvents} of {totalEvents} events are complete ({completedEvents} run so far)," shown whenever `completedEvents < qualifyingEvents` and the season has data — i.e. for all of 2026 until event 4 lands. The header copy ("Best N of M scores count...") and the existing per-row Provisional badges are unaffected beyond picking up the raised threshold automatically.

**Ranking unchanged:** still points-desc, name-asc — no new sort key. A dominant 2-event driver can still out-point a slower 3-event driver; only what counts as "dropped" changed, not how ties or ordering work.

**Arithmetic guarantee intact:** the M1.14 "a driver can only win in one class" guarantee (`2 × threshold > N`) still holds, since actual scoring groups ingested can never exceed `N` by construction (`N = max(planned, actual)`).

**Known limitations:** `listSeasonYears` still only lists years with at least one ingested event — a year present in `PLANNED_SEASON_EVENTS` with zero events isn't navigable via the season switcher; acceptable since the season page is only useful once something has been ingested. Mid-season, `docs/private/compare-official.ts` will diverge from official season-end exports (which are computed against the final N) until the 4th event of a 6-event season lands — expected, not a regression.

**Files:** `apps/web/src/lib/constants.ts`, `apps/web/src/lib/season-leaderboard.ts`, `apps/web/src/app/leaderboard/season-leaderboard-view.tsx`, `apps/web/src/app/leaderboard/page.tsx`, `apps/web/src/app/leaderboard/[year]/page.tsx`, `apps/web/tests/season-leaderboard.test.ts`, `apps/web/tests/combined-event.test.ts`, `docs/BUILD.md`, `docs/PRD.md`.

### M1.17 — Driver page combined-event handling + progression last-point tooltip fix ✓ (done 2026-07-20)

A member reported two `/drivers/[id]` UX bugs: (1) hovering the progression chart never showed a tooltip on the true *last* point — hover resolved only as far as the second-to-last; (2) a combined event (M1.15: two same-date sessions, e.g. "Cone in 60 Seconds (A)"/"(B)") still rendered as two independent history rows and chart points with per-session, not combined, position/percentile — the one place in the app M1.15 didn't reach (explicitly called out as left as-is in that milestone).

**Root cause (linking both bugs):** both charts key the X-axis on `dataKey="label"`, the formatted date. A combined pair produces two identical labels (e.g. two `"Jul 18, 2026"` points); recharts (`allowDuplicatedCategory` default) mis-resolves the tooltip on the last of two duplicate categories. Collapsing the pair into one point removes the duplicate label and fixes the reported symptom directly. Separately, recharts' point-scale can place a genuinely-last point on the plot edge outside the hoverable band, so the axis was also hardened for that general case.

**Design:**

- **Collapsing (`apps/web/src/lib/driver-history.ts`):** `buildDriverHistory` now issues two queries — first the driver's own events (to learn which calendar dates they have any exposure to), then a second, **driver-unfiltered** query for every session sharing one of those dates. The second query is required: a driver who skipped one session of a combined pair wouldn't appear in that session's entries at all, so a driver-filtered query alone would under-detect the group and silently score the forfeit as a plain single event. Events are grouped by the same UTC date key used in `season-leaderboard.ts` / the combined page; a group of 1 goes through (the now-extracted) `buildSingleEventRow` unchanged, a group of ≥2 goes through new `buildCombinedHistoryRow`.
- **Combined row ranking:** pooled PAX time **summed** across every session, consistent with the rest of this page (which pools all entrants class-agnostically, unlike the per-class `/events/combined/[date]` and season leaderboard). A driver qualifies for the ranked pool only with a countable best in **every** session, **in the same class** throughout — mirrors the forfeit rule in `combined-event.ts` / `season-leaderboard.ts`. A forfeiting driver still gets a row (position/percentile/bestPax null), matching the existing DNF-only-event convention.
- **New `DriverHistoryRow` fields:** `href` (`/events/[slug]` or `/events/combined/[date]`) and `combined: boolean`. `EventHistory` (`event-history.tsx`) links both the mobile card and desktop table row through `href` and shows a small "Combined" badge when `combined` is true.
- **Chart axis hardening:** both `progression-chart.tsx` and `time-delta-chart.tsx` add `padding={{ left: 8, right: 8 }}` to their shared `XAxis`, so the first/last point-scale bands sit inside the hoverable area rather than flush against the plot edge — cheap robustness for any genuinely-last point, independent of the label-collision fix above.

**Tests:** `apps/web/tests/driver-history.test.ts` gained a `buildDriverHistory — combined events (M1.17)` block reusing the existing M1.15 `combined-event-*.axdb` fixtures (already regenerated by `pretest`) rather than new fixtures — asserts a same-date session pair collapses to one `combined: true` row with summed PAX, pooled position/percentile/median across the qualifying pool, and the `/events/combined/[date]` href; a driver missing one session keeps its row with nulled position/percentile/bestPax; and a driver's non-combined events on the same page are untouched. All pre-existing cases pass unchanged.

**Files:** `apps/web/src/lib/driver-history.ts`, `apps/web/src/app/drivers/[id]/event-history.tsx`, `apps/web/src/app/drivers/[id]/progression-chart.tsx`, `apps/web/src/app/drivers/[id]/time-delta-chart.tsx`, `apps/web/tests/driver-history.test.ts`, `docs/BUILD.md`, `docs/PRD.md`.

### League Foundation — Multi-tenant data model ✓ (done 2026-07-22)

PR 1 of a broader "any autocross club can self-host Launch Control" initiative. Ships a DB-native tenant/scoring model with **no user-facing behavior change** for the existing PCA RMR deployment — every seeded default reproduces production byte-for-byte.

**Data model:**

- **`League`** (new) — one row per deployment: branding (`name`, `siteTitle`, `siteDescription`, `landingDescription`, `footerText`), `accessGate` (`"required" | "optional" | "none"`), `msrOrgId`, `smugmugUser`, `smugmugDisciplinePath`. `apps/web/src/lib/league-config.ts` resolves the row named by `DEFAULT_LEAGUE_SLUG` (env, default `"pca-rmr"`) — the only tenant-selecting env var — and is now the single source every route/page reads branding, the access gate, and SmugMug config from. `msrOrgId` / `smugmugUser` / `smugmugDisciplinePath` still fall back to the legacy `MSR_ORG_ID` / `MSR_RMR_ORG_ID` / `SMUGMUG_USER` / `SMUGMUG_DISCIPLINE_PATH` env vars, but only when the League row leaves the field `null` — a transitional shim, not a permanent dual-config surface.
- **`ScoringSystem`** (new) — named scoring presets owned by a league (`policy`: a JSON `ScoringPolicy` v1 string, see `apps/web/src/lib/scoring-policy.ts`). Seeded preset: "PCA Classic" — `{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}`, today's production scoring behavior, byte-identical.
- **`Season`** (new) — one row per league-year. `scoringPolicy` is a **snapshot** copy of a `ScoringSystem`'s policy at creation time, never a live reference, so editing a preset later never reshapes a past season's standings. `plannedEvents` replaces the old code-level `PLANNED_SEASON_EVENTS` map (M1.16) as the source for `seasonScoringBasis()`'s dynamic qualifying threshold. New rows are created via `pnpm --filter web season:create` (`apps/web/scripts/create-season.ts` → `src/lib/create-season.ts`); ingest also auto-creates a bare Season (oldest preset on the league, `plannedEvents: 0`) the first time it sees an event year with none.
- **`LeagueMembership`** (new) — `(leagueId, msrUid, role)` where `role` is `"ADMIN" | "MEMBER"`. `apps/web/src/lib/admin.ts`'s `isAdmin()` is a compatibility shim: the pre-existing `ADMIN_MSR_UIDS` env allowlist is checked first and short-circuits before any DB read; only a uid that misses the allowlist falls through to an ADMIN `LeagueMembership` lookup on the deployment's default league. The table seeds empty — no UI writes these rows yet, so only manual `prisma studio` edits populate it today; membership-management UI is future scope.
- **`Event.seasonId`** and **`CarClass.leagueId`** are now required foreign keys — previously the "season" was implicit (`date.getFullYear()`) and `CarClass.code` was globally unique. Both are scoped per-season/per-league now.
- **`Event.axdbSha256` renamed to `sourceSha256`**, and its uniqueness moved from global to `@@unique([seasonId, sourceSha256])` — two different leagues/seasons can now legitimately re-ingest byte-identical fixture data without colliding.

**Seed & backfill migration (`20260722020000_league_foundation`):** hand-written, not `prisma migrate dev` — it must run an ordered seed plus two table rebuilds deterministically on every deploy:

1. Create the four new tables (`League`, `ScoringSystem`, `Season`, `LeagueMembership`).
2. Seed the `pca-rmr` League row and its "PCA Classic" `ScoringSystem` preset — production branding/scoring strings, copied verbatim (the upstream-compatibility contract).
3. Seed one `Season` per **distinct year** already present in `Event` rows, `scoringPolicy` a literal copy of the PCA Classic policy, `plannedEvents` mirroring the old `PLANNED_SEASON_EVENTS` map (2026→6, else 0). A fresh, eventless DB seeds no Seasons here — ingest's auto-create path covers that case.
4. **Table-rebuild `Event`**: add the now-required `seasonId`, backfilled by joining each event's year to the Season just seeded; re-scope `sourceSha256` uniqueness to per-season.
5. **Table-rebuild `CarClass`**: add the now-required `leagueId`, backfilled to `pca-rmr`; re-scope `code` uniqueness to per-league.

Both rebuilds use the standard Prisma/SQLite table-rebuild pattern (`PRAGMA defer_foreign_keys=ON` + `foreign_keys=OFF`, `CREATE new_* → INSERT…SELECT → DROP → RENAME`) — existing `Entry`/`Run`/`Video` rows and their foreign keys survive untouched; ids are preserved.

**Deploy runbook:**

> ⚠️ **This migration rebuilds the `Event` and `CarClass` tables in place.** Back up the production DB before running it (Turso: a platform snapshot, or `turso db shell <db> .dump` piped to a file).

1. **Required pre-flight query.** The migration moves `Event.sourceSha256` uniqueness from global to per-`(seasonId, sourceSha256)` (season derived from `strftime('%Y', date)` for this backfill). Before migrating, confirm no existing data would collide under the new scope:

   ```sql
   SELECT CAST(strftime('%Y', date) AS INTEGER) y, sourceSha256, COUNT(*) c
   FROM Event
   WHERE sourceSha256 IS NOT NULL
   GROUP BY y, sourceSha256
   HAVING c > 1;
   ```

   **Must return 0 rows.** A non-empty result means two events in the same calendar year share a `sourceSha256` — resolve the duplicate (or diagnose why two distinct events hashed the same) before migrating; don't proceed with an unresolved collision.

2. **Migrate and promote back-to-back, in the same deploy window — never leave a deploy half-migrated.** Run `pnpm --filter web db:migrate` (applies `prisma migrate deploy` against Turso) immediately before promoting the build that expects the new schema. A build running the new code against the old (pre-migration) schema, or the old code against the new schema, is unsupported and untested — the app fails loudly (`[league-config] no League row for DEFAULT_LEAGUE_SLUG=...`) rather than serving degraded, but that's a symptom to avoid, not a safety net to rely on.
3. Confirm `DEFAULT_LEAGUE_SLUG` is set correctly for the target environment (unset defaults to `pca-rmr`, correct for the existing production deployment — only set it explicitly when standing up a genuinely new tenant).
4. Smoke-test `/`, `/leaderboard`, and one `/events/[slug]` page post-deploy to confirm the seeded League/Season rows resolved correctly.

**Follow-up (not landed in this PR):** `Season.scoringPolicy.conePenaltyMs` is validated and enforced-equal to the shared `CONE_PENALTY_MS` constant (throws at season-load time on a mismatch — see `scoring-policy.ts` / `season-leaderboard.ts`), but isn't yet threaded into the per-entry cone math in `entry-best.ts` / `combined-event.ts` / `leaderboard.ts`. A season configured with a different cone penalty is rejected at load time rather than silently mis-scored; true per-season cone penalties await a later PR. `LeagueMembership` management UI (create/edit/remove ADMIN rows from the admin surface, rather than `prisma studio`) is also deferred.

### League Multi-Club (PR 2) — RMsolo pipeline, public browsing, Docker ✓ (done 2026-07-23)

PR 2 of the multi-club initiative, stacked on League Foundation (PR 1). Ships a second league (RMsolo) with its own full ingest pipeline, makes every league publicly browsable, and closes the deferred cone-penalty/error-boundary/backfill-test gaps PR 1 left open. Default-league (`pca-rmr`) routes remain byte-identical to PR 1 throughout — this PR is additive.

**`Season.slug` migration (`20260723010000_season_slug`):** hand-written table rebuild adding a required `slug TEXT` column to `Season`, unique per `(leagueId, slug)`, backfilled for existing rows by a SQL approximation of `slugify()` (fixed punctuation set — space/underscore/apostrophe/period/ampersand/slash → `-`, collapsed, trimmed — see the migration's own header comment for the exact set and its limitation vs. the full TS `slugify()`). This is the addressing key `/l/[league]/leaderboard/s/[seasonSlug]` resolves against. It also **lifts create-season's old duplicate-year refusal** — season uniqueness is now by slug, not by `(leagueId, year)`, so a second season in the same calendar year (e.g. a Winter Series alongside a Summer Series) is a supported CLI operation, not just a schema possibility. `resolveSeasonBySlug(leagueId, slug)` and `activeSeason(leagueId)` (status `active`, newest year, tie newest id) in `src/lib/season-resolve.ts` are the two resolution paths pages use.

**Multi-league data model summary:**

- **RMsolo pipeline** (`src/lib/rmsolo-index.ts`/`rmsolo-parse.ts`/`rmsolo-pax.ts`/`rmsolo-ingest.ts`, ported from the archived `feat/rmsolo-ingest` branch, league-agnostic parsing + league-targeted ingest): `ingestRmsoloEvent({ leagueSlug, ... })` resolves/auto-creates the event's `Season` scoped to that league, and creates/updates `CarClass` rows scoped to that league (same class code can carry different PAX factors in two different leagues — isolation is by construction in the ingest write path, not a DB constraint, same posture as the `.axdb` path).
- **Per-season PAX tables:** `getRmsoloPaxIndex` precedence is `Season.paxTable` JSON (per-season override) → built-in `RMSOLO_PAX_2026` table → a derived factor from run-group placement (`nearestPaxClass`) → `1.0` with a warning. No CLI flag writes `paxTable` today (a `--write-pax-table` option was scoped and dropped as YAGNI) — it's hand-edited or seeded via `season:create --policy-file`/direct DB write.
- **`league:create` CLI** (`src/lib/create-league.ts` + `scripts/create-league.ts`): creates a `League` row plus a default `ScoringSystem` preset in one transaction (a league needs at least one preset before `resolveOrCreateSeason`'s ingest-time auto-create path can work). Mirrors `season:create`'s lib/CLI split. `--gate` defaults to `"required"` — see the operational invariant below.
- **Public browsing routes** (login-less, respect each league's own gate): `/leagues` (directory), `/l/[league]` (home/events), `/l/[league]/leaderboard[/s/[seasonSlug]]`, `/l/[league]/events/[slug]`. Legacy routes (`/`, `/leaderboard[/year]`, `/events/...`) are unchanged and always resolve `DEFAULT_LEAGUE_SLUG`.
- **Driver stats filters** (`/drivers/[id]`, `src/lib/driver-history.ts`): `?league=<slug|all>` × `?season=<id>` / `?from=&to=` / all-time. Counts aggregate across leagues under `league=all`; progression/time-delta charts always render one series per league.
- **Cone-penalty threading (PR 1's deferred item, closed):** `bestCorrectedMsForEntry` / `leaderboard.ts` / `combined-event.ts` now accept a `penaltyMs` parameter (default `CONE_PENALTY_MS`), sourced from the entry's season's `scoringPolicy.conePenaltyMs`. The PR 1 throw-guard (season-load-time mismatch check against the shared constant) is removed now that the value is actually wired end-to-end instead of merely validated.
- **App-level `error.tsx`:** a friendly message + error digest, no stack/internals leaked to the client; a malformed `scoringPolicy` still throws loudly server-side (visible in logs) but no longer renders a raw framework 500 page to visitors.
- **Two-league coexistence** (`apps/web/tests/multi-league.test.ts`): one DB, PCA league (`.axdb` synthetic fixture) + RMsolo league (synthetic parsed events) — asserts `CarClass` same-code isolation with different factors, standings isolation, `/leagues` data-fn sees both, a cross-league driver (same identity hash in both leagues) aggregates per the driver-stats rules above, and legacy routes stay default-league-only.

**Operational invariant (carried to AGENTS.md and README):** only the default league may run with `accessGate: "required"` — per-login MSR membership (`isRmrMember`) is checked against the *default* league's org only; `LeagueMembership` (per-league roles) isn't wired into gating yet. `league:create --gate` does not refuse `"required"` on a non-default league today, so this is an operator discipline, not an enforced constraint — true per-league membership is PR 3 scope.

**Docker (`Dockerfile`/`compose.yaml`/`deploy/launchcontrol.env.example`, ported from the archive, already club-agnostic):** the optional `ingest` sidecar profile passes `--league "$${INGEST_LEAGUE:-}"` to `ingest:rmsolo`; an empty/unset `INGEST_LEAGUE` falls through to `DEFAULT_LEAGUE_SLUG` (the ingest CLI's own default, not a shell conditional). `deploy/launchcontrol.env.example` documents both `DEFAULT_LEAGUE_SLUG` and `INGEST_LEAGUE`, plus the first-boot step for adding a second league/season via `docker compose exec web pnpm --filter web league:create/season:create`. See the Appendix note below — containerization is no longer a deferred item.

### League Admin (PR 3) — two-tier roles, membership gating, PAX snapshots ✓ (done 2026-07-23)

PR 3 of 3 in the multi-club initiative. Closes PR 2's two deferred gaps — `LeagueMembership` had no write path and only the default league could gate on MSR org membership — with a real role model, and separately freezes PAX scoring against a snapshot so a later factor correction can't reach back and reshape an already-scored event.

**Role model — two tiers:**

- **Superuser** (`src/lib/super-user.ts`) — global, deployment-wide. Bootstrapped irrevocably from the `ADMIN_MSR_UIDS` env allowlist (checked first, no DB read) or granted via a `SuperUser` row (`{ msrUid }`, unique). `setSuperUser()` refuses to revoke a uid that's still in the env allowlist — the env bootstrap can only be undone by editing the env var. A superuser administers every league and bypasses every per-league gate.
- **Per-league membership** (`src/lib/membership.ts`, `LeagueMembership` table, `(leagueId, msrUid)` unique) — `role` is one of `ADMIN` / `MEMBER` / `BLOCKED`. `ADMIN` grants that one league's admin surface (`isLeagueAdmin()`); `MEMBER` and `ADMIN` both satisfy a `"required"` access gate for that league; `BLOCKED` denies it outright, overriding an org match. Written today only via the admin UI (`/admin/leagues/[slug]/members`) and its REST route (`POST/DELETE /api/admin/leagues/[slug]/members`) — no more manual `prisma studio` edits needed.
- **Gate helpers** (`src/lib/admin.ts`): `isLeagueAdmin(msrUid, leagueId)` (superuser OR ADMIN row on that league), `isAnyLeagueAdmin(msrUid)` (superuser OR ADMIN row on any league — gates the coarse `/admin` entry point), `administeredLeagues(msrUid)` (every league for a superuser, else just the leagues where the uid holds an ADMIN row — feeds the `/admin` index and the events/audit league filters).

**Access decision chain (`decideLeagueAccess`, `src/lib/league-access.ts`) — exact order:**

1. Superuser → **allow** (unconditional).
2. `membershipRole === "BLOCKED"` → **deny**.
3. `membershipRole` is `"ADMIN"` or `"MEMBER"` → **allow**.
4. `accessGate !== "required"` (i.e. `"optional"`/`"none"`) → **allow**.
5. `msrOrgId` set on the league AND the session's `msrOrgIds` includes it → **allow**.
6. Otherwise → **redirect** (bounce to sign-in, `returnTo` preserved).

Public gates (`"optional"`/`"none"`) short-circuit at step 4 without any session or DB read, so a `BLOCKED` row only ever bites on a `"required"` gate — "BLOCKED is gated-access-only" is by design, not an oversight. `checkLeagueAccess()`/`requireMember()` in `src/lib/session.ts` resolve this chain per-league (superuser + membership-role lookups run in parallel via `Promise.all`), replacing the old default-league-only `isRmrMember` flag as the sole per-league gate; both call sites turn `"deny"` into a no-`returnTo` redirect (no point looping a blocked user back to sign-in) and `"redirect"` into a `returnTo`-carrying one. **Both temporary PR 2 guards that refused a `"required"` gate on any non-default league are deleted now that real per-league gating exists:** `league-config.ts`'s `toLeagueConfig` throw, and `createLeague`'s refusal of `--gate required` (see README update below).
**Disclosure:** org matching reads `session.msrOrgIds`, captured at MSR login (Task 5) — sessions minted before this field shipped lack it and fall through to step 6 (redirect); affected users simply re-login. `/admin/audit`'s league filter is an approximation (best-effort match against audit detail, not a hard FK) — see the route's own comment for the exact heuristic.

**PAX snapshot semantics (`Entry.paxIndexApplied`, `src/lib/pax-applied.ts`/`pax-reapply.ts`):**

- **Stamped at ingest, not read live.** Both pipelines (`src/lib/ingest.ts` for AxWare, `src/lib/rmsolo-ingest.ts` for RMsolo) resolve the PAX factor once at ingest time and write it onto `Entry.paxIndexApplied`. Scoring (`appliedPaxIndex()`) reads that frozen column, falling back to the live `entry.paxClass.paxIndex` join only when the snapshot is `null` (a data anomaly post-backfill, not the normal path). Net effect: editing a `CarClass.paxIndex` later (a rules-committee correction, a new season's table) never reaches back and reshapes an already-scored entry.
- **Backfilled frozen-at-migration-time.** Migration `20260724020000_entry_pax_applied` adds the nullable `Decimal` column and backfills every pre-existing `Entry` from its **current** `CarClass.paxIndex` — the real at-ingest factor for old rows is unrecoverable (same caveat as `Driver.nameOnlyHash`), so historical entries freeze at whatever the live table said on migration day, not at whatever it said when they actually raced.
- **Re-apply blast radius (`reapplySeasonPaxFactors()`):** an admin action, scoped to **one `Season`** at a time (`POST /api/admin/leagues/[slug]/seasons/[seasonSlug]/pax-reapply`, surfaced from the season editor). It reads that season's own `Season.paxTable` JSON (`{ code: factor }`, validated by `parseSeasonPaxTableStrict()` — positive finite numbers only, throws otherwise) and stamps `paxIndexApplied` onto every `Entry` under that season whose `paxClass.code` is a key of the table — scoped additionally to the season's own league, since `CarClass.code` is only unique per-league. Codes **absent** from the table are left untouched (an entry ingested under a class the season's override table doesn't cover keeps whatever was stamped at ingest). This is a deliberate, bounded history rewrite: one season's worth of entries, one admin click, auditable (`writeAudit` records the `{ updated, codes }` result under `action: "season.update"`).

**Ingest-now capability gating (`src/lib/rmsolo-run.ts`, `POST /api/admin/leagues/[slug]/ingest-now`):** the on-demand "Ingest now" admin-dashboard button (shipped in Task 18, doc'd here for completeness) is gated by `ingestNowCapability()` — `INGEST_NOW_ENABLED=1` env AND a memoized `pdftotext -v` probe — so the button/route is invisible/disabled unless both the operator opted in and poppler is actually on `PATH`. The route's full chain: `guardLeagueAdmin(slug)` (404 fail-closed, not 403 — a non-admin can't distinguish "no such league" from "not allowed") → capability gate (501 + reason) → a per-league in-process mutex (409 if a scrape is already running for that league) → run the shared scrape (`runRmsoloIngest`, the same code path as the CLI and the sidecar) → best-effort audit write (`action: "ingest.now"`, failure logged but doesn't fail the request) → JSON counts.

**Other surfaces shipped in this PR** (see task history for detail): league/season/scoring-preset admin CRUD (lib functions + REST routes + dialogs under `/admin/leagues/[slug]/...`); a members-only lock badge on `/leagues` directory cards for `"required"`-gate leagues; league-scoped driver routes; a per-season Events tab on league pages.

**Deferred / known limitations:** audit's league filter is a best-effort approximation, not a hard join (see above). Sessions minted before `msrOrgIds` shipped need a re-login to get per-league org gating. `BLOCKED` has no effect on public (`"optional"`/`"none"`) leagues by design.

**Deploy runbook (two new migrations, both additive — much lower-risk than League Foundation's table rebuilds above):**

- **`20260724010000_super_user`** — `CREATE TABLE "SuperUser"` + a unique index on `msrUid`. New table only; nothing existing is touched. Deliberately **not** backfilled from `ADMIN_MSR_UIDS` — the env allowlist stays the irrevocable bootstrap (same posture as `LeagueMembership`: env is config, rows are data).
- **`20260724020000_entry_pax_applied`** — `ALTER TABLE "Entry" ADD COLUMN "paxIndexApplied" DECIMAL` (nullable), then one `UPDATE` backfilling every existing row from its **current** `CarClass.paxIndex` via a correlated subquery. The backfill is idempotent — re-running it just re-sets each row to today's live factor again, a no-op if no `CarClass.paxIndex` changed in between.
- **Back up first** (same as League Foundation's runbook: a Turso platform snapshot, or `turso db shell <db> .dump` piped to a file) — the `Entry` backfill is a bulk `UPDATE` across every row in the table.
- **One `pnpm --filter web db:migrate` run applies both** (`prisma migrate deploy` runs pending migrations in filename order — `..._super_user` then `..._entry_pax_applied` — in a single invocation). No seed step, no pre-flight collision query (unlike League Foundation) — both migrations are unconditionally safe to run against any prior schema state.
- Promote the build in the same window as the migration, per the existing rule above: old code against the new schema, or new code against the old schema, is unsupported.

### Ruleset scoring parameters — qualification/drop ownership ✓ (done 2026-07-24)

The ruleset-centric admin rework exposed that the old `floor(N/2)+1` formula was doing two unrelated jobs: it determined both how many events a driver needed for an Official standing and how many scores were dropped. Those values now have explicit, independent owners:

- `Season.plannedEvents` is the expected scoring-event count and `Season.minimumEvents` is the attendance threshold for Official vs. Provisional.
- `ScoringPolicy` v4 on the live `ScoringSystem` ruleset owns `dropCount` and `dropTiming` (`fixed` or `proportional`), along with PAX-section and cone-penalty settings, plus (v4) the per-event `points` system — `{type: "ratio1000", basis}` or `{type: "position", table, beyondTable, basis}` — where `basis: "class"` or `"event"` selects the population a driver is scored against (`src/lib/scoring-policy.ts`, `src/lib/event-points.ts`).
- The season editor exposes planned and minimum events. The ruleset editor exposes numeric drops and timing. Controlled selects receive value-to-label item maps, so a stored numeric ruleset id renders its name instead of the raw id.

Migration `20260725020000_ruleset_scoring_parameters` adds `Season.minimumEvents`, converts every v2 policy to v3, and preserves existing standings. It computes each season's prior effective size from `max(plannedEvents, distinct event dates)`, backfills the old threshold/minimum and implied drop count, and clones a shared ruleset only when its assigned seasons previously implied different drop counts. The active/latest season keeps the original ruleset id; historical variants are reassigned to deterministic clones. No Event, Entry, Run, Driver, or PAX data is rewritten. Empty unplanned seasons use the new-season defaults (`minimumEvents=4`, `dropCount=2`) because no prior size exists to infer from.

**Deploy runbook:**

1. Take a Turso snapshot before deployment and save baseline row counts for `Season`, `Event`, `Driver`, `CarClass`, `Entry`, `Run`, `Video`, and `AdminAuditLog`.
2. Run `pnpm --filter web db:migrate`, then deploy the matching application build in the same window.
3. Confirm `PRAGMA foreign_key_check;` returns no rows and `PRAGMA quick_check;` returns `ok`. Re-run the baseline counts; only `ScoringSystem` is expected to grow, by the number of historical drop-count variants that had shared a ruleset.
4. Run this preservation check. It must return `0` before promotion:

```sql
WITH season_totals AS (
  SELECT
    s.id,
    MAX(s.plannedEvents, COUNT(DISTINCT date(e.date))) AS totalEvents
  FROM Season s
  LEFT JOIN Event e ON e.seasonId = s.id
  GROUP BY s.id
)
SELECT COUNT(*) AS preservation_mismatches
FROM Season s
JOIN season_totals totals ON totals.id = s.id
JOIN ScoringSystem ruleset ON ruleset.id = s.rulesetId
WHERE (
    totals.totalEvents > 0
    AND (
      s.minimumEvents != CAST(totals.totalEvents / 2 AS INTEGER) + 1
      OR json_extract(ruleset.policy, '$.dropCount')
         != totals.totalEvents - (CAST(totals.totalEvents / 2 AS INTEGER) + 1)
    )
  )
  OR (
    totals.totalEvents = 0
    AND (
      s.minimumEvents != 4
      OR json_extract(ruleset.policy, '$.dropCount') != 2
    )
  );
```

If any integrity check or baseline comparison fails, stop promotion and restore the snapshot; this migration changes policy JSON and season-to-ruleset assignments, so reverting only the application build is not a complete rollback.

### Vehicle classing guide ✓ (done 2026-08-25)

A per-league answer to "what class does my car run in?", replacing a static HTML table generated out-of-band and published on the club's own site (`enginerdify/rmr-pca-classing` → rmr.pca.org).

**The model is checked-in repo data, not DB rows.** `League`/`Season`/`ScoringSystem` are per-deployment tenant config and belong in the DB; a classing table is a published rulebook that changes about once a season, wants PR review, and is read on every page that draws a class badge — where a DB lookup would be a Turso round trip for data that never varies between deployments. So: `src/data/classing/<league-slug>.json`, imported by a slug-keyed registry.

- `src/lib/classing.ts` — pure: shape, strict validation (`parseClassingModel`, which names the offending path), per-season grouping (`classingForSeason`), tooltip projection (`classVehicleLines`), and the picker's resolver (`lookupClass`/`lookupModels`/`lookupYears`/`lookupTrims`).
- `src/lib/classing-registry.ts` — the JSON imports, the league registry, and the `classingHints`/`classingHintsByKey` helpers server pages use. Split from `classing.ts` purely so `scripts/classing-import.ts` can reuse the validator to *write* the files this module reads.
- `scripts/classing-import.ts` (`pnpm --filter web classing:import --league <slug> <classing.yml>`) — converts upstream YAML, repairing its known defects loudly rather than silently: a trim object keyed `trims:` instead of `trim:`, a placeholder vehicle with nothing but a `type:`, and `version: 0.1` (a YAML float) meaning `.1`. Writes no DB rows, so no audit entry. `yaml` is a devDependency — the converter is build-time only and never ships to the runtime bundle.

**Two deliberate divergences from the upstream generator.** It solves for a minimal set of "season span" columns (`2024` | `2025-2026`) with a greedy set-cover; with real `Season` rows and a season switcher already in the chrome, the page renders one season at a time driven by `?season=` and that entire search disappears. And it drops the engine-size qualifier during grouping, so its published table silently over-claims (the G-Series 911 Turbo is C1 only up to 3.3L) — `displacementMax` is carried through grouping here and shown as a condition on the trim, and on the lookup result.

Verified against the published table: the 2026 grouping is line-for-line identical, including the cases the collapse logic exists for — `996.1`/`996.2` merging into one `996 911 · 1999-2004` line because their trims match, `987.1` (S) and `987.2` (S, R) staying separate because theirs don't, and `992 911 · 2020+` keeping its open end when merged.

**Routes.** `/l/[league]/classing` is the page; `/classing` is the legacy alias for the default league. **Both are ungated** — the one public league-scoped route in the app. There is no PII and no results data in a classing table, and it is precisely what a prospective entrant reads before deciding to show up; results routes keep their existing gate untouched. A league with no model 404s and shows no subnav tab (RMsolo today).

**Class hover cards.** `src/components/class-badge.tsx` is now the single class-badge component; the event leaderboard, combined-event table, and driver event history each carried their own copy before, so a class code rendered differently depending on where you saw it. It opens a `HoverCard` (`src/components/ui/hover-card.tsx`) listing the class's cars for that event's season. Built on Base UI's **Popover**, not its Tooltip: Tooltip is hover/focus-only and would never open on a phone, while Popover's `openOnHover` keeps desktop hover *and* the press-to-open a popover already has. Data is one `ClassingHints` prop resolved per render on the server — no per-row work, no client fetch — and its absence is what makes the badge fall back to its old plain rendering (unclassed league, or PCA's time-only `TO`).

`DriverHistoryRow` gained `seasonYear`/`seasonSlug`, and `eventDetailInclude`/`combinedSessionInclude` gained `season.year`/`season.name`/`season.slug`: classing is per (league, season), the driver page's rows can span both, and a season may straddle a calendar year, so it is not derivable from `Event.date`. The **year** selects the vehicle lines (the upstream rulebook is written per calendar year, so two Season rows sharing a year — a main season and a winter series — correctly resolve to the same table); the **slug** addresses the guide, so a card's "Full classing guide →" opens `?season=<that row's season>` rather than the league's active one, which on a historical event could class the same car differently. `classingKey` is therefore `(leagueSlug, seasonSlug)`.

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
| 17 | Derived mid-season qualifying threshold (`N` = actual ingested groups) penalized drivers who'd attended more events than have currently been ingested. Fix? | Base `N` on the planned season size instead: a per-year code map (`PLANNED_SEASON_EVENTS` in `src/lib/constants.ts`), `N = max(planned, actual)`. Years absent from the map keep the pre-M1.16 derived behavior unchanged. Ranking stays points-desc, name-asc — no new sort key. | 2026-07-19 | M1.16 |
| 19 | Where does the per-league vehicle classing model live — DB rows with an admin editor, or checked-in repo data? | **Repo data** (`src/data/classing/<league-slug>.json`, imported by `src/lib/classing-registry.ts`). `League`/`Season`/`ScoringSystem` are per-deployment tenant config and rightly live in the DB; a classing table is a *published rulebook* — it changes about once a season, wants PR review, is identical across every deployment of that league, and is read on every page that draws a class badge, where a DB lookup would be a Turso round trip for data that never varies. Upstream stays the YAML in `enginerdify/rmr-pca-classing`; `pnpm --filter web classing:import` regenerates the JSON. Revisit if a league ever needs to edit classing without a deploy. | 2026-08-25 | Vehicle classing guide |
| 18 | Take TypeScript 7 (Dependabot #109)? | **No — held at v6.** Under TS 7 the lint step dies with `TypeError: Cannot read properties of undefined (reading 'Cjs')`: `eslint-config-next` pins `typescript-eslint` 8.x transitively and `apps/web/eslint.config.mjs` consumes `eslint-config-next/typescript` directly, so it can't be routed around from this repo. Added a `version-update:semver-major` ignore for `typescript` in `.github/dependabot.yml` (#122), mirroring the existing eslint v9 hold, so the PR isn't regenerated weekly. Revisit when `typescript-eslint` ships TS 7 support. | 2026-07-28 | — |

---

## Appendix · Post-MVP Deployment Hardening

Out of scope for the MVP but noted to keep prior thinking discoverable:

- ~~**Containerization** (Docker / `docker-compose`) for parity between dev, preview, and prod.~~ **Done, PR 2 (2026-07-23):** `Dockerfile` + `compose.yaml` + `deploy/launchcontrol.env.example`, ported from the archived `feat/rmsolo-ingest` branch and made league-aware (`--league`/`INGEST_LEAGUE` on the ingest sidecar). This is an optional self-host path alongside the existing Vercel+Turso production deployment, not a replacement for it — see "League Multi-Club (PR 2)" above.
- **Background ingestion worker** if `.axdb` uploads outgrow Vercel function limits.
- ~~**Revisit the `better-sqlite3` dependency.**~~ **Largely resolved by `better-sqlite3` 13.0.1 (merged 2026-07-28, #108).** `apps/web/src/lib/axdb-validate.ts` and `apps/web/src/lib/ingest.ts` both import `better-sqlite3` to read user-uploaded `.axdb` SQLite files. It is still a native addon (statically links SQLite C), but v13's rewrite onto [N-API](https://nodejs.org/api/n-api.html) removed the install-time friction that motivated replacing it:
  - **No install step at all.** v13 ships **no `install` / `preinstall` / `postinstall` script**, dropped the `prebuild-install` dependency (that pruned ~234 lines from `pnpm-lock.yaml`), and publishes prebuilt binaries inside the tarball at `prebuilds/<platform>-<arch>.node` — `linux-x64`, `linux-arm64`, `linuxmusl-*`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`. `lib/binding.js` selects one at require time, falling back to a `build/{Debug,Release}` node-gyp compile only on a target with no published prebuild.
  - **ABI matching is gone.** N-API is ABI-stable across Node majors, so one binary per platform/arch serves every runtime. The old `<node-abi>-<platform>-<arch>` prebuild lookup — and the Node 24 / ABI v137 darwin-arm64 source-build fallback it forced — no longer applies.
  - Consequently the `node-gyp` macOS Command Line Tools trap (detected via `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables`, not `xcode-select -p`, aborting with "No Xcode or CLT version detected!" even with the toolchain on disk) is only reachable on an unsupported platform/arch. The `better-sqlite3` entry in `pnpm-workspace.yaml`'s `onlyBuiltDependencies` is now a **no-op** — kept only as insurance against a pin back below v13.
  - **Still open, and independent of the above:** Vercel-vs-CI strictness drift, which hit us on 2026-06-03. A malformed `pnpm-lock.yaml` from Dependabot passed Vercel's default `pnpm install` (which regenerates the lockfile in the build sandbox) but broke GH Actions' `pnpm install --frozen-lockfile`. Consider setting Vercel's install command to `pnpm install --frozen-lockfile` so prod and CI fail together. See [docs/dependabot.md](./dependabot.md) → Failure mode 1.
  - **Candidate replacements** — no longer urgent, since the build step they were meant to eliminate is already gone. Retained only as a simplification option: **`node:sqlite`** (built into Node ≥ 22.5, zero install, sync API in the same shape — a mechanical diff in the two consumer files) is the one worth considering; **`sql.js`** (WASM, but async + whole-file-in-memory) and **`@libsql/client`** (still native underneath, and async-only) both cost an async refactor for no remaining gain.

---

## Outstanding Review Feedback

- [ ] Use the /identifier-naming skill on that PRD just to double-check the names of tables, variables, etc.
- [x] Prisma has great DX, but if things get complex with queries you might prefer Drizzle ORM
- [x] If using SQLite, the Turso library is great to have local/remote duality
- [x] For OAuth (or authentication in general), I recommend Better Auth, so you don't have to build your own auth manually
- [x] For Calendars and scheduling you can use cal.com (they have an open source version)
- [x] VisualAX author review of PRD (2026-05-27) — clarifications on co-driver numbering, multi-event `.axdb` format, `unique_numbers` / `paxed_class` fields, and excessive-run handling; incorporated into BUILD.md.
