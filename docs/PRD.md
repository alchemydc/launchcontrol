# PCA Launch Control — Product Requirements

**Project:** Launch Control — an autocross results platform. PCA Rocky Mountain Region is the reference deployment; the platform serves multiple leagues from one deployment as of PR #99.

### Glossary

- **MSR** — [MotorsportReg.com](https://www.motorsportreg.com), the registration and identity system used by PCA regions (including RMR). Source of truth for member identity.
- **League** — a club/tenant. One `League` row per club, holding its branding, access gate, MSR org id, and SmugMug lookup config. Tenant identity is **DB data, not config**: a single deployment can host several leagues at once, each independently ingestable and browsable. `DEFAULT_LEAGUE_SLUG` (env, default `pca-rmr`) only selects which league the legacy unprefixed routes serve.
- **Season** — one competition year within a league, addressed by a `slug` unique to that league. Owns `plannedEvents` (expected scoring-event count) and `minimumEvents` (attendance required for an Official standing), and points at a live **Ruleset**. Two seasons may share a calendar year (e.g. a Winter Series alongside a Summer Series).
- **Ruleset** (`ScoringSystem`) — a named, league-owned scoring preset (e.g. "PCA Classic"). Owns drop count and drop timing, cone penalty, whether to show a PAX section, and the complete PAX table. Seasons reference a ruleset **live**, so editing it immediately affects every season assigned to it — except PAX-table edits, which reach existing entries only via an explicit per-season re-apply (see PAX below).
- **VisualAX** — desktop timing software used at-event by RMR, created and maintained by RMR member Doug Bartlett. Emits a SQLite database file with the extension `.axdb` after each event. Real season exports live in the gitignored `real_season_data/` directory locally; they contain member PII and must never be committed or used as CI fixtures. Each exported `.axdb` typically contains a single event; the file format supports multiple events (VisualAX's season-points feature) but RMR has not used it.
- **RMsolo** — SCCA Rocky Mountain Solo, the second league on the reference deployment, and the second ingest pipeline: its results are scraped/parsed from published PDFs rather than a timing-software export. Parsing is league-agnostic; ingest is league-targeted.
- **PAX** — class index multiplier applied to raw time to produce a normalized "PAX time" for cross-class comparison. **Class standings always rank on PAX-indexed best time** (a pure rescale of raw for any class whose entries share one factor, so PCA's per-class ordering is unaffected). Separately, a ruleset's `paxSection` toggle adds a synthetic *overall*-PAX standings section across all classes — off for PCA RMR, on for RMsolo. The factor applied to an entry is **snapshotted at ingest** onto `Entry.paxIndexApplied`, so a later factor correction never silently reshapes an already-scored event; an admin re-applies a corrected table one season at a time.
- **Run group** — the on-event run order grouping (e.g., green/yellow). Tracked per-event by VisualAX.
- **Combined event / session** — RMR occasionally runs one event day as two (or more) discrete mini-events exported as separate same-date `.axdb` files (e.g. "Cone in 60 Seconds (A)" AM / "(B)" PM). Each exported file is a **session**; sessions sharing a calendar date are auto-grouped into one **combined event** for scoring and standings, with results at `/events/combined/[date]`. See BUILD.md M1.15 for the grouping/scoring design.

---

## Part 1 · Product Requirements

### 1.1 Vision

A streamlined, high-performance web platform for the Porsche Club of America Rocky Mountain Region. The MVP focuses on Autocross (AX) and track events by (a) unifying member identity via MSR, (b) auto-publishing 2026 event results from VisualAX `.axdb` files, and (c) centralizing community media links.

**Beyond the MVP (shipped in PR #99):** the "keep the door open for other clubs" goal is now realized rather than aspirational. Any autocross club can be served as its own **League** — with its own branding, access policy, ingest pipeline, seasons, and scoring rules — either alongside PCA RMR on one deployment or self-hosted via the Docker path. PCA RMR remains the reference deployment, and its routes and results are unchanged by the multi-league work.

### 1.2 Personas

- **Driver / Competitor** — wants a clean mobile-responsive results dashboard (raw / PAX / class), and a way to view or share event media. May appear in more than one league; driver stats can be filtered per-league or aggregated across all of them.
- **League Admin / Timing Chief** — wants frictionless MSR login, a dead-simple way to publish a post-event `.axdb` so leaderboards appear immediately, and a way to fix upload mistakes (bad metadata, duplicates) without touching the database. Administers **one** league: its events, members, seasons, and rulesets.
- **Superuser / Operator** — deployment-wide. Stands up new leagues, grants league admins, and administers every league. A superuser granted in-app can be revoked in-app; one bootstrapped from the env allowlist can only be removed by editing that env var.

### 1.3 Feature Scope

§1.3.1–1.3.2 and §1.3.4 are the original MVP scope; §1.3.3 covers the multi-league and ruleset-administration capabilities added in PR #99.

#### 1.3.1 Auth & Identity (MSR)

- **MSR OAuth 1.0a login** — authenticate users against their MSR profile. Chosen because RMR PCA AX drivers must already have an MSR account to register for events.
- **Signed session cookie** — HttpOnly, SameSite=Lax, signed, keyed on the MSR user UID returned by `/rest/me`.
- **Per-league access gate** — each League sets its own `accessGate` (`required` / `optional` / `none`), so one deployment can host a members-only league and a fully public one side by side. For a `required` gate, access resolves in this exact order: superuser → allow; `BLOCKED` membership → deny; `ADMIN`/`MEMBER` membership → allow; gate is not `required` → allow; the session's MSR org ids include the league's org → allow; otherwise redirect to sign-in. Unauthenticated and non-member visitors see a landing page describing what they'll unlock. Deep links round-trip through OAuth via `?returnTo=`, sanitized against open-redirect. Membership is captured at login (`msrOrgIds`), so gating needs no live MSR call.
- **Two-tier roles** — a **superuser** is global (bootstrapped from the `ADMIN_MSR_UIDS` env allowlist, or granted a `SuperUser` row) and administers every league; the allowlist bootstrap cannot be revoked from inside the app. Per-league roles live on `LeagueMembership` (`ADMIN` / `MEMBER` / `BLOCKED`) and are managed from the admin UI — no direct DB editing.
- **Dynamic public calendar (M3 — not yet shipped)** — `/calendar` will fetch the league's MSR event calendar server-side and cache it for 5 minutes.

#### 1.3.2 VisualAX `.axdb` ingestion

VisualAX remains the primary ingest path and PCA RMR's at-event source of truth. A second, independent pipeline (**RMsolo**, PDF-based) was added for the RMsolo league; both write through the same normalization, redaction, and PAX-snapshot rules described here.

- **PII redaction at ingest** — driver last names from VisualAX are reduced to a single uppercase initial + period (e.g. `K.`) before any row reaches the app DB. The full last name is never persisted by this app. See architecture notes in [docs/BUILD.md](./BUILD.md) for schema and mapping details.
- **Local ingest CLI (M1)** — `pnpm ingest [--league <slug>] <path-to-axdb>` reads the source SQLite read-only, normalizes (with redaction) into the app DB, and targets one league (defaulting to `DEFAULT_LEAGUE_SLUG`). Idempotent on re-run.
- **RMsolo ingest CLI** — `pnpm ingest:rmsolo [--league <slug>]` parses published results PDFs, either from a named file or by scraping the results index. Parsing is league-agnostic; the write path is league-scoped, so the same class code can carry different PAX factors in two leagues without collision.
- **Admin upload (M4)** — multipart admin-only upload endpoint reuses the same ingest logic.
- **Admin event management (M4.1)** — `/admin/events` lists every ingested event and lets admins fix bad uploads in-browser: edit name/date/location (the URL slug regenerates using the same convention as ingest, with a 409 guard against colliding with an existing event), or delete an event behind a confirmation dialog showing exactly what will be removed. Deleting cascades entries/runs/videos and sweeps drivers left with no entries or videos. Every admin ingest/edit/delete writes a persistent `AdminAuditLog` row (actor MSR UID + redacted `First L.` name, JSON detail), viewable by admins at `/admin/audit`.
- **Dynamic leaderboards** — `/events/[slug]` renders sortable, filterable tables: overall raw, PAX/indexed, class standings; per-driver run details (cones, DNF/RRN dispositions). Driver column shows `First L.` only. Every league is also browsable at its own prefix — `/leagues` (directory), `/l/[league]` (home/events), `/l/[league]/leaderboard[/s/[seasonSlug]]`, `/l/[league]/events/[slug]` — each gated on *that* league's own policy. The legacy unprefixed routes above continue to serve `DEFAULT_LEAGUE_SLUG` unchanged.
- **Combined-event standings** — when two or more events share a calendar date (a multi-session combined event, e.g. an AM/PM split day), `/events/combined/[date]` renders per-class + overall standings ranked by summed best-corrected time across sessions, mirroring the club's own handout format. Session pages cross-link to the combined page and vice versa.
- **Driver profile combined-event handling (M1.17)** — `/drivers/[id]` also collapses a same-date session pair into one summed data point, so the progression chart, percentile/position math, and the Event History list all show one row per combined event instead of one per session. Ranked by pooled PAX time summed across sessions (this page is pooled-PAX and class-agnostic throughout, unlike the per-class combined-event/season-leaderboard pages), with the same forfeit rule: a driver only counts when they have a countable time in every session, in the same class.

#### 1.3.3 League, season & ruleset administration

Shipped in PR #99. Everything below is admin UI plus a REST route; standing up or reconfiguring a club no longer requires a developer, a redeploy, or direct DB access.

- **League administration** — `/admin` lists the leagues the signed-in user administers (all of them, for a superuser). Per league: branding and access-gate settings, member management (`/admin/leagues/[slug]/members`, granting `ADMIN` / `MEMBER` / `BLOCKED`), season CRUD, and ruleset CRUD.
- **Rulesets as data, not code** — a league's scoring rules (drop count, drop timing, cone penalty, PAX section, and the complete PAX table) are edited in-app. There is no hardcoded points formula and no hardcoded org id anywhere in the codebase.
- **Deliberate blast radius on edits** — a season references its ruleset **live**, so a policy edit takes effect immediately for every season assigned to it. PAX-*table* edits are the exception: they do not touch already-scored entries until an admin explicitly re-applies the table to **one selected season**, which is audited. This keeps a rules correction from silently rewriting past standings.
- **Qualification and drops are independent** — `Season.minimumEvents` decides Official vs. Provisional standing; the ruleset's `dropCount` decides how many scores are discarded. These were previously coupled in one `floor(N/2)+1` formula.
- **New leagues and seasons** — created via the admin UI, or `pnpm --filter web league:create` / `season:create` for scripted setup. Ingest auto-creates a bare Season the first time it sees an event year with none.
- **Self-hosting** — a Docker path (`Dockerfile` / `compose.yaml`, with an optional ingest sidecar) exists alongside the hosted deployment, so a club can run its own instance.

#### 1.3.4 Media aggregation

Event pages and the home event list surface a **Photos** link to the matching SmugMug gallery, discovered via fuzzy name + date match against a configured SmugMug account/discipline path.

**Scope:** SmugMug config is **per-League** (`smugmugUser` / `smugmugDisciplinePath` on the League row), so each club supplies its own account and discipline path; the legacy `SMUGMUG_*` env vars are honored only as a fallback when a League leaves the field null. Per-**event** folder overrides and an admin UI to confirm/override fuzzy matches remain Future scope (see decision #9 in [BUILD.md](./BUILD.md)'s Decisions Log).

Driver-submitted YouTube/Vimeo links remain a Future scope item, not shipped.

---

## Part 2 · Definition of Done

- **Type safety:** `"strict": true` everywhere; `any` is forbidden. CI runs `tsc --noEmit`.
- **Ingestion correctness:** integration test ingests the synthetic `apps/web/tests/fixtures/synthetic.axdb` (committed) and asserts driver counts, run counts, class PAX multipliers, and that every persisted `Driver.lastInitial` matches `/^[A-Z?]\./`. A regex sweep on the dumped DB confirms no full last name beyond the first character appears in any Driver, Entry, or Run row.
- **PII rule:** the full last name of any driver is used only transiently to compute the identity hash and must never be persisted to the app DB or appear in any leaderboard rendering.
- **Data invariants (RMR / AxWare convention):**
  - **One class per driver per event.** A human enters each event in at most one car class. Co-drives are modeled by VisualAX as separate `drivers` rows with a number-suffix convention (`337` + `337X`, `62` + `162`) and resolve to separate app `Driver` records via the identity-hash dedupe at ingest (see `apps/web/src/lib/ingest.ts`). The schema is permissive (`Entry` has no `(eventId, driverId)` uniqueness, to handle a club whose convention differs) but RMR real data has never violated this invariant. Season scoring (M1.14) depends on it: the "one championship class per driver" arithmetic guarantee (`2 × qualifyingThreshold > N`) only holds when this invariant holds.
  - **Combined (same-date, multi-session) events (M1.15).** Events sharing a calendar date are auto-grouped into one scoring event — no schema change, no ingest flag, no admin linking step. A combined event counts **once** toward the season's event totals. A driver earns points only when they have a countable (CLEAN, per `bestCorrectedMsForEntry`) time in **every** session of the group, **in the same class**; class mismatch across sessions or a missing session forfeits that scoring group entirely (fail-safe — shouldn't occur under RMR convention). The redaction/PII rule applies identically to the combined-standings page. `Season.plannedEvents` and actual scoring groups determine the displayed season size; `Season.minimumEvents` independently controls Official vs. Provisional eligibility.
- **Auth boundary (admin):** every route under `/api/admin/*` requires a session whose MSR UID is a superuser or holds an `ADMIN` `LeagueMembership` on the league being acted on. League-scoped admin routes fail **closed with 404**, not 403 — a non-admin must not be able to distinguish "no such league" from "not allowed". `ADMIN_MSR_UIDS` is now only the superuser bootstrap, not the whole admin model.
- **Admin data management:** event delete must fully cascade (entries → runs, videos) and remove drivers left with no entries and no videos; edit must never mint a duplicate slug (409 on collision). Every admin ingest/edit/delete is recorded in `AdminAuditLog` with the actor's name stored redacted (`First L.` — the PII rule applies to audit rows too). Integration-tested in `apps/web/tests/admin-events.test.ts`, including a regression test that delete + re-ingest produces exactly one `Event` row.
- **Auth boundary (public pages):** every event/leaderboard page resolves the access decision chain for **its own league** — legacy routes (`/`, `/events/[slug]`, `/leaderboard`, `/leaderboard/[year]`, `/drivers/[id]`) against `DEFAULT_LEAGUE_SLUG`, and `/l/[league]/...` against that league. A league gated `required` needs a valid MSR session plus superuser, membership, or an MSR org match; `optional`/`none` leagues short-circuit to allow with no session and no DB read. Blocked users are redirected **without** `returnTo` (no point looping them back to sign-in); redirected-but-eligible users keep it. `returnTo` is sanitized against open-redirect on both write and read.
- **Tenant isolation:** no hardcoded org UUIDs or points formulas in code. `CarClass.code` is unique per-league and `Event.sourceSha256` per-season, so two leagues can carry the same class code with different PAX factors, and can re-ingest byte-identical fixture data, without collision. Covered by `apps/web/tests/multi-league.test.ts`, which runs two leagues in one DB and asserts class, standings, and legacy-route isolation.
- **Vercel:** preview deploy for every PR; main deploys to production on merge.

---

## Part 3 · Active Open Questions

No active open questions.

---

## Part 4 · Future Scope

- Allow driver to add tunes, tires, setup changes to a "vehicle timeline" which should expose and help analyze performance impact of changes made.
- ~~Allow driver to track performance against leaders or specific rivals visually.~~ **Shipped in M1.7** for "vs. event leader." Specific-rival comparison still open.
- ~~Generalize SmugMug integration beyond RMR/Autocross … per-region config keyed off a future `Region` entity.~~ **Partly shipped in PR #99** — the tenant entity exists (`League`) and carries per-club `smugmugUser` / `smugmugDisciplinePath`. Still open: per-**event** folder overrides (admin-set), and an optional admin UI to confirm/override fuzzy matches.
- ~~Add explicit `Event.seasonYear Int` column (migration + ingest update) so season is decoupled from calendar year and indexed for fast season queries.~~ **Shipped in PR #99**, and better than proposed: a first-class `Season` entity with a required `Event.seasonId` foreign key. Season is fully decoupled from calendar year — a league can run two seasons in one year, each addressed by its own slug.
- ~~Series scoring rules as data.~~ **Shipped in PR #99:** `Season.plannedEvents` records the expected scoring-event count and `Season.minimumEvents` the attendance required for an Official standing; each Season points to a live `ScoringSystem` ruleset whose v3 policy owns `dropCount`, `dropTiming`, PAX-section behavior, and cone penalty; qualification and dropped-score count are deliberately independent. Still open: configurable **points formulas**, tiebreakers, and single-car vs. multi-car rules, which a future club or rule change may need.
- Driver-submitted YouTube/Vimeo video links tied to event + driver + run group + car class.
- Multi-event `.axdb` ingest support. Current ingest enforces single-event with a fail-loud guard (BUILD.md → Ingestion Strategy → Single-event assumption). VisualAX's format supports multiple events per file via its season-points feature; relevant only if another region adopts the platform and uses that workflow.
- `classes.paxed_class` (PAX-adjusted classes like eXpert / Novice). VisualAX supports a class-level PAX overlay on top of per-class PAX. RMR doesn't use this and our `CarClass` model doesn't represent it. A blocker for any club that does.
