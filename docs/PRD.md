# PCA Launch Control — Product Requirements

**Project:** PCA RMR community web platform (MVP)

### Glossary

- **MSR** — [MotorsportReg.com](https://www.motorsportreg.com), the registration and identity system used by PCA regions (including RMR). Source of truth for member identity.
- **VisualAX** — desktop timing software used at-event by RMR, created and maintained by RMR member Doug Bartlett. Emits a SQLite database file with the extension `.axdb` after each event. Real season exports live in the gitignored `2026_season_data/` directory locally; they contain member PII and must never be committed or used as CI fixtures. Each exported `.axdb` typically contains a single event; the file format supports multiple events (VisualAX's season-points feature) but RMR has not used it.
- **PAX** — class index multiplier applied to raw time to produce a normalized "PAX time" for cross-class comparison. Not used by RMR PCA presently.
- **Run group** — the on-event run order grouping (e.g., green/yellow). Tracked per-event by VisualAX.

---

## Part 1 · Product Requirements

### 1.1 Vision

A streamlined, high-performance web platform for the Porsche Club of America Rocky Mountain Region. The MVP focuses on Autocross (AX) and track events by (a) unifying member identity via MSR, (b) auto-publishing 2026 event results from VisualAX `.axdb` files, and (c) centralizing community media links.

MVP targets PCA RMR specifically, but design choices that don't add cost should keep the door open for other PCA regions and clubs.

### 1.2 Personas

- **RMR Driver / Competitor** — wants a clean mobile-responsive results dashboard (raw / PAX / class), and a way to view or share event media.
- **RMR Admin / Timing Chief** — wants frictionless MSR login and a dead-simple way to publish a post-event `.axdb` so leaderboards appear immediately.

### 1.3 MVP Feature Scope

#### 1.3.1 Auth & Identity (MSR)

- **MSR OAuth 1.0a login** — authenticate users against their MSR profile. Chosen because RMR PCA AX drivers must already have an MSR account to register for events.
- **Signed session cookie** — HttpOnly, SameSite=Lax, signed, keyed on the MSR user UID returned by `/rest/me`.
- **RMR-member gate on all event/leaderboard pages** — `/`, `/events/[slug]`, `/leaderboard`, `/leaderboard/[year]`, and `/drivers/[id]` render to RMR-organization members only. Unauthenticated visitors and signed-in non-RMR users see a landing page at `/` describing what they'll unlock. Deep links round-trip through OAuth via `?returnTo=`.
- **Dynamic public calendar** — `/calendar` fetches the RMR org's MSR event calendar server-side and caches it for 5 minutes.

#### 1.3.2 VisualAX `.axdb` ingestion

- **PII redaction at ingest** — driver last names from VisualAX are reduced to a single uppercase initial + period (e.g. `K.`) before any row reaches the app DB. The full last name is never persisted by this app. See architecture notes in [docs/BUILD.md](./BUILD.md) for schema and mapping details.
- **Local ingest CLI (M1)** — `pnpm ingest <path-to-axdb>` reads the source SQLite read-only, normalizes (with redaction) into the app DB. Idempotent on re-run.
- **Admin upload (M4)** — multipart admin-only upload endpoint reuses the same ingest logic.
- **Dynamic leaderboards** — `/events/[slug]` renders sortable, filterable tables: overall raw, PAX/indexed, class standings; per-driver run details (cones, DNF/RRN dispositions). Driver column shows `First L.` only.

#### 1.3.3 Media aggregation

Event pages and the home event list surface a **Photos** link to the matching SmugMug gallery, discovered via fuzzy name + date match against a configured SmugMug account/discipline path.

**Scope:** MVP is RMR-only (single-tenant, configured via env vars), but the requirement explicitly calls out that this should be extensible to any club that uses SmugMug — per-club/per-event overrides are Future scope (see open question #9).

Driver-submitted YouTube/Vimeo links remain a Future scope item, not shipped.

---

## Part 2 · Definition of Done

- **Type safety:** `"strict": true` everywhere; `any` is forbidden. CI runs `tsc --noEmit`.
- **Ingestion correctness:** integration test ingests the synthetic `apps/web/tests/fixtures/synthetic.axdb` (committed) and asserts driver counts, run counts, class PAX multipliers, and that every persisted `Driver.lastInitial` matches `/^[A-Z?]\./`. A regex sweep on the dumped DB confirms no full last name beyond the first character appears in any Driver, Entry, or Run row.
- **PII rule:** the full last name of any driver is used only transiently to compute the identity hash and must never be persisted to the app DB or appear in any leaderboard rendering.
- **Auth boundary:** every route under `/api/admin/*` returns 401 unless the session is present and the MSR UID is in the admin allowlist.
- **Auth boundary:** all event/leaderboard pages (`/`, `/events/[slug]`, `/leaderboard`, `/leaderboard/[year]`, `/drivers/[id]`) require a valid MSR session AND RMR-organization membership. Unauth and non-RMR visitors are routed to the landing page at `/`. Deep-link `returnTo` is honored only for RMR members (dropped for non-RMR to avoid bounce loops) and sanitized against open-redirect on both write and read.
- **Vercel:** preview deploy for every PR; main deploys to production on merge.

---

## Part 3 · Active Open Questions

No active open questions.

---

## Part 4 · Future Scope

- Allow driver to add tunes, tires, setup changes to a "vehicle timeline" which should expose and help analyze performance impact of changes made.
- ~~Allow driver to track performance against leaders or specific rivals visually.~~ **Shipped in M1.7** for "vs. event leader." Specific-rival comparison still open.
- Generalize SmugMug integration beyond RMR/Autocross: per-event folder overrides (admin-set), or per-region config keyed off a future `Region` entity. Optional admin UI to confirm/override fuzzy matches.
- Add explicit `Event.seasonYear Int` column (migration + ingest update) so season is decoupled from calendar year and indexed for fast season queries.
- Series scoring rules as data: RMR's qualifying-threshold formula (`floor(N/2) + 1` of N season events) lives in code as of M1.13; multi-car / multi-class participation is allowed as of M1.14 (the M1.13 single-car-per-season constraint was reversed by the AX chair). Future regions or rule changes would want a per-season `RuleSet` (events-counted formula, points formula, drop-week count, tiebreakers, single-car vs multi-car rule).
- Driver-submitted YouTube/Vimeo video links tied to event + driver + run group + car class.
- Multi-event `.axdb` ingest support. Current ingest enforces single-event with a fail-loud guard (BUILD.md → Ingestion Strategy → Single-event assumption). VisualAX's format supports multiple events per file via its season-points feature; relevant only if another region adopts the platform and uses that workflow.
- `classes.paxed_class` (PAX-adjusted classes like eXpert / Novice). VisualAX supports a class-level PAX overlay on top of per-class PAX. RMR doesn't use this and our `CarClass` model doesn't represent it. A blocker for any future region that does.
