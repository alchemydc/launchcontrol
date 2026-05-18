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

- **Local ingest CLI (M1)** — `pnpm ingest <path-to-axdb>` reads the source SQLite read-only, normalizes into the app DB. Developers point this at their gitignored `2026_season_data/*/.axdb` files for local smoke testing; CI/tests use a synthetic fixture (see DoD).
- **Admin upload (M4)** — `POST /api/admin/ingest` (multipart, admin-only) reuses the same ingest logic.
- **Dynamic leaderboards** — `/events/[slug]` renders sortable, filterable tables: overall raw, PAX/indexed, class standings; per-driver run details (cones, DNF/RRN dispositions, splits).

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

No Docker, Nginx, or Tailscale in the MVP. See the post-MVP appendix for hardening options.

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
  lastName    String
  memberNum   String?
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
| `drivers.*`                                | `Driver` (match by `member_num` if present; else upsert)     |
| `registrations`                            | `Entry` (one row per driver-event)                           |
| `runs.finish_tick - runs.start_tick`       | `Run.rawTimeMs` (null when disposition='DNF' and no time)    |
| `runs.cones`                               | `Run.cones`                                                  |
| `runs.disposition`                         | `Run.disposition` (`''→CLEAN`, `'DNF'→DNF`, `'RRN'→RRN`)     |

---

## Part 3 · Build Plan (Milestones)

**Status (2026-05-18):** M0 ✓ · M1 ✓ · M2–M5 not started · MSR OAuth creds requested, awaiting response.

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
  - class PAX multipliers preserved (`C1`=1.0, `CS`=0.92, `TO`=0.85).
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
| 4 | Vercel free tier OK for MVP? Custom domain plan?                                                     | Deploy  | TBD   |
| 5 | Admin allowlist: which MSR UIDs / emails bootstrap as admin?                                         | M4      | TBD   |
| 6 | Series scoring (cumulative across events) — in MVP, or post-MVP? Source CSVs exist in season data.   | Scope   | TBD   |

---

## Appendix · Post-MVP deployment hardening

Out of scope for the MVP but noted to keep prior thinking discoverable:

- **Containerization** (Docker / `docker-compose`) for parity between dev, preview, and prod.
- **Tailscale ACL** for staging exposure before the site is public.
- **Postgres** (or Supabase) migration if multi-writer / multi-region concurrency or row-level auth becomes a requirement.
- **Background ingestion worker** if `.axdb` uploads outgrow Vercel function limits.


## Feedback on PRD from other devs

- Use the /identifier-naming skill on that PRD just to double-check the names of tables, variables, etc.
- Prisma has great DX, but if things get complex with queries you might prefer Drizzle ORM
- If using SQLite, the Turso library is great to have local/remote duality
- For OAuth (or authentication in general), I recommend Better Auth, so you don't have to build your own auth manually
- For Calendars and scheduling you can use cal.com (they have an open source version)


