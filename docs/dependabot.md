# Dependabot runbook

Merging Dependabot PRs in this repo has repeatedly gotten stuck and required manual
surgery (#23, #54, #64). This doc explains the preventive config now in place and gives
an exact recovery recipe for the one failure mode that still bites (plus a second that
`better-sqlite3` 13 has since made obsolete, kept for anyone on an older branch).

The app is a pnpm workspace (`apps/web`, pnpm `10.25.0`). CI (`.github/workflows/ci.yml`,
the **`web`** check) runs `pnpm install --frozen-lockfile` → prisma generate → lint →
typecheck → test → build.

## TL;DR

- Merge Dependabot PRs one at a time; **let each rebase onto latest `main` and re-pass CI
  before merging** (branch protection now enforces this).
- If `main` ends up with `ERR_PNPM_BROKEN_LOCKFILE … duplicated mapping key`, see
  [Failure mode 1](#failure-mode-1--broken-lockfile-duplicate-keys).
- The old `Could not locate the bindings file … better_sqlite3.node` trap is **fixed** as of
  `better-sqlite3` 13 — no more `pnpm install --force` in the routine. See
  [Failure mode 2](#failure-mode-2--better-sqlite3-native-binary-fixed-by-v13).

## Why it broke (root cause)

`pnpm-lock.yaml` is the shared blast radius. When a Dependabot PR is merged while its base
has moved (because another dep PR merged first), GitHub performs a **three-way merge of the
lockfile to build the merge commit**. That merged lockfile is **never run through CI** — so a
malformed result (duplicate top-level keys: `tinyglobby@…` in #54, `semver@7.8.4` in #64)
lands directly on `main`. From then on `pnpm install --frozen-lockfile` fails for everyone,
and Dependabot's own parser can't rebase the remaining PRs — they have to be closed and
replaced by a hand-built fix PR.

The enabler was that `main` had **no branch protection**, so nothing required a PR to be
up-to-date (and re-CI'd) before merging.

## Prevention in place

1. **Branch protection on `main` — required status check `web` with "strict" (up-to-date)
   enabled.** A PR can't be merged unless its branch is current with `main` and the `web`
   check passed *on that updated branch*. This turns the untested 3-way lockfile merge into a
   CI-tested update — the single change that would have prevented all three incidents.
   - ⚠️ Do **not** use the admin "merge without waiting for requirements" override on any PR
     that touches `pnpm-lock.yaml`. That bypass re-opens the exact hole this closes.
2. **Dependabot grouping (`.github/dependabot.yml`).** Named groups (react, next, prisma,
   tailwind) plus `dev-minor-patch` and a catch-all `production-minor-patch` group collapse
   most weekly updates into a handful of PRs instead of one-per-dependency, so the lockfile
   mutates far less often. Major bumps still get individual PRs (they need scrutiny).
3. **Held majors (`ignore:` in `.github/dependabot.yml`).** Two `version-update:semver-major`
   holds are in place, each blocked on the same upstream problem — the eslint plugin set that
   `eslint-config-next` pins transitively:
   - **`eslint` at v9** — awaiting v10-compatible peer ranges from `eslint-plugin-react` /
     `-import` / `-jsx-a11y`. See #22, #31.
   - **`typescript` at v6** — under TS 7 the lint step dies with
     `TypeError: Cannot read properties of undefined (reading 'Cjs')`, because
     `eslint-config-next` pins `typescript-eslint` 8.x and `apps/web/eslint.config.mjs`
     consumes `eslint-config-next/typescript` directly, so there's no way to route around it.
     See #109, #122.

   Re-check both when `eslint-config-next` makes a major move; drop the entry to let the bump
   back in.
4. **Repo settings:** `allow_auto_merge` and `delete_branch_on_merge` are on. You can queue a
   Dependabot PR to merge automatically once strict CI passes (`gh pr merge <n> --auto
   --merge`, or comment `@dependabot merge`), and merged branches are cleaned up.

## Supply-chain controls

The sections above are about *merge mechanics*. These three settings are about not pulling in
a poisoned release in the first place. They read as ordinary dependency config, so they're
easy to "clean up" by accident — don't.

1. **`minimumReleaseAge: 4320` (`pnpm-workspace.yaml`)** — pnpm refuses to resolve any version
   published in the last 3 days. Registry compromises are typically caught and unpublished
   within hours, so an aging window converts most of them into a non-event. It applies only
   when the lockfile is *regenerated* (`pnpm update`, `pnpm add`, Dependabot);
   `pnpm install --frozen-lockfile` in CI and the Dockerfile resolves from the lockfile and is
   unaffected. Requires pnpm ≥ 10.16 and must live in `pnpm-workspace.yaml` — pnpm 10 no longer
   reads non-auth settings from `.npmrc`.
   - Side effect: a Dependabot rebase can land inside the window and resolve nothing. Re-run it
     once the window elapses; that's the control working, not a failure.
   - There is a `minimumReleaseAgeExclude` escape hatch. Nothing here needs same-day releases —
     leave it unset.
2. **`cooldown.default-days: 3` (`.github/dependabot.yml`)** — the same window on the PR-opening
   side, so Dependabot doesn't propose a bump pnpm would then refuse. GitHub has defaulted this
   to 3 days since 2026-07-14; it's pinned here so the posture survives a default change.
   Security updates deliberately bypass the cooldown.
3. **`onlyBuiltDependencies` (`pnpm-workspace.yaml`)** — pnpm 10 blocks dependency lifecycle
   scripts (`preinstall`/`install`/`postinstall`) by default; this list is the allowlist, and it
   currently holds four entries. Only two of them still have a script to run:

   | Entry | Lifecycle script | Notes |
   | --- | --- | --- |
   | `prisma` | `preinstall` | real — `scripts/preinstall-entry.js` |
   | `@prisma/engines` | `postinstall` | real — positions the engine binaries |
   | `@prisma/client` | none | no-op today |
   | `better-sqlite3` | none | no-op since v13 — see [Failure mode 2](#failure-mode-2--better-sqlite3-native-binary-fixed-by-v13) |

   The two no-ops are harmless and worth keeping as insurance against a pin back to a version
   that does build. Re-check with:

   ```bash
   # from the repo root — reads the pnpm store directly, since @prisma/engines
   # is transitive and not resolvable from apps/web
   for f in node_modules/.pnpm/{better-sqlite3,prisma}@*/node_modules/{better-sqlite3,prisma}/package.json \
            node_modules/.pnpm/@prisma+{client,engines}@*/node_modules/@prisma/{client,engines}/package.json; do
     [ -f "$f" ] && node -p "
       const p = require('./$f');
       p.name + '@' + p.version + ' -> ' +
       (['preinstall','install','postinstall'].filter(k => (p.scripts ?? {})[k]).join(', ') || 'none')"
   done 2>/dev/null | sort -u
   ```

   **Adding a package here grants it arbitrary code execution on every `pnpm install`, on every
   developer machine and CI runner.** Add an entry only when an install visibly fails without
   it, and prefer `ignoredBuiltDependencies` for packages whose build step we don't need.
   `pnpm approve-builds` will happily append to this list — review what it wrote.

Worked example — the **ChainDrop** npm worm (2026-08-04), which poisoned `keyv@6.0.0`,
`flat-cache@6.1.24`, `file-entry-cache@11.1.6` and ~450 other packages with a credential-stealing
`preinstall` script. This repo was not affected: it carries those packages only transitively under
`eslint` at pre-attack majors (4.5.4 / 4.0.1 / 8.0.0), which the declared `^` ranges can't escape.
Had it been reachable, control 3 would have stopped the payload from executing and control 1 would
have stopped the version from being installed at all — npm unpublished the malicious releases
within ~1 hour.

## Routine merge workflow

With strict checks on, order barely matters — each PR is forced to re-CI against latest
`main` before it can merge. From outside the sandbox (authenticated `gh` needs your SSH key):

```bash
# See what's open and green
gh pr list --repo alchemydc/launchcontrol --state open --author app/dependabot
gh pr checks <n> --repo alchemydc/launchcontrol

# Merge one. If its branch is behind main, update it first (button does this, or):
gh pr comment <n> --repo alchemydc/launchcontrol --body "@dependabot rebase"
# …wait for CI green again, then:
gh pr merge <n> --repo alchemydc/launchcontrol --merge
```

Or let each merge itself once CI is green: `gh pr merge <n> --repo alchemydc/launchcontrol
--auto --merge`.

**A lockfile PR can need more than one rebase.** Any PR that touches `pnpm-lock.yaml` goes
`BEHIND`/`BLOCKED` the moment *another* PR merges into `main` — and strict checks won't let
it merge until it's up-to-date again. So if you rebase PR B while PR A is still landing (or a
third PR merges during B's ~4-5 min rebase+CI cycle), B comes back `BEHIND` and needs a second
`@dependabot rebase`. To minimize this churn, merge the PRs that **don't** touch the lockfile
first (GitHub Actions bumps, workflow-only changes), then the lockfile PRs strictly one at a
time — wait for each to fully merge before rebasing the next. When polling, gate on the branch
actually being current, not just green: require both `mergeStateStatus == CLEAN` **and** a
fresh `web` pass on the *new* head SHA (a stale pre-rebase run still shows `pass`).

After the batch, run the [local CI mirror](#local-ci-mirror-verification) against `main` to
confirm the lockfile is healthy.

## Failure mode 1 — broken lockfile (duplicate keys)

**Symptom:** on `main` (or a Dependabot branch that can't rebase):

```
ERR_PNPM_BROKEN_LOCKFILE  The lockfile at "…/pnpm-lock.yaml" is broken:
duplicated mapping key (8066:3)
```

**Don't** keep commenting `@dependabot rebase` — its parser fails on the same file every time.

**Recovery (the #64 playbook).** Rebuild the lockfile cleanly off current `main` and fold the
stuck PRs into one superseding fix PR:

```bash
# 1. Clean branch off the latest main (a worktree keeps your working tree untouched)
git fetch origin
git worktree add -B fix/lockfile-rebuild "$TMPDIR/lockfix" origin/main
cd "$TMPDIR/lockfix"

# 2. Apply the stuck PRs' package.json bumps by hand. Find each PR's intended versions:
#    git show origin/<dependabot-branch>:apps/web/package.json | grep '"<pkg>"'
#    then edit apps/web/package.json to match.

# 3. Regenerate the lockfile from scratch (also prunes stale transitive cruft)
pnpm install --lockfile-only

# 4. Sanity: the lockfile must be self-consistent
pnpm install --frozen-lockfile --ignore-scripts   # must NOT error

# 5. Full CI mirror (see below) — lint, typecheck, test, build must pass

# 6. Commit, push, open a PR that supersedes the stuck ones
git add apps/web/package.json pnpm-lock.yaml && git commit
git push -u origin fix/lockfile-rebuild
gh pr create --repo alchemydc/launchcontrol --base main --title "…" --body "…supersedes #A #B"

# 7. After it merges, close the stuck PRs
gh pr close <A> <B> --repo alchemydc/launchcontrol --delete-branch \
  --comment "Superseded by #<fix>, which repairs the broken lockfile on main."
```

Notes:
- The regenerated `pnpm-lock.yaml` diff is **large** (hundreds of deletions in #64) — that's
  the cleanup of stale transitive entries, not breakage. Before trusting it, confirm any
  package that *disappears* (e.g. `msw`, `@inquirer/*`, `yargs` in #64) is **not** a declared
  dependency and **not** imported (`grep -rn "<pkg>" apps/web/package.json apps/web/src`).
- Because the fix branch is built on current `main`, merging it is a clean fast-forward of the
  lockfile — no 3-way merge, so no new duplicate key.

## Failure mode 2 — better-sqlite3 native binary (fixed by v13)

**This no longer happens on `main`.** `better-sqlite3` **13.0.1** (merged 2026-07-28, #108)
rewrote the addon onto [N-API](https://nodejs.org/api/n-api.html) and **removed the install
step entirely**. Concretely, as of v13:

- The package has **no `install` / `preinstall` / `postinstall` script at all** — nothing to
  run, so nothing to skip. Its only runtime dep is `node-addon-api` (build-time headers).
- `prebuild-install` is **gone** from the dependency tree (that removal alone pruned ~234
  lines from `pnpm-lock.yaml`).
- Prebuilt binaries ship **inside the published tarball** at `prebuilds/<target>.node`, one
  per platform/arch (`linux-x64`, `linux-arm64`, `linuxmusl-*`, `darwin-x64`, `darwin-arm64`,
  `win32-x64`, `win32-arm64`). `lib/binding.js` picks one at require time from
  `process.platform` / `process.arch`, with musl detected via `process.report`.
- Because N-API is **ABI-stable**, one binary serves every Node major. The old
  `<node-abi>-<platform>-<arch>` matching problem — and the Node-24/ABI-137 source-build
  fallback that came with it — is structurally gone.

So a cached or fresh-worktree `pnpm install` cannot leave you without a working binary on any
of those targets, and **`pnpm install --force` is no longer part of the routine**. Verify with:

```bash
ls node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/prebuilds/
```

Note the `better-sqlite3` entry in `pnpm-workspace.yaml`'s `onlyBuiltDependencies` is now a
**no-op** (there is no build script left to approve). It is harmless, and worth keeping only
as insurance if the dep is ever pinned back below v13.

Only if you land on an **old branch or worktree still pinned to `better-sqlite3` 12.x** can
the original failure surface:

```
Error: Could not locate the bindings file. Tried:
 → …/better-sqlite3@<ver>/…/build/Release/better_sqlite3.node
 …
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 pretest: …
```

There the fix was `pnpm install --force` (a real reinstall that runs build scripts and
compiles the addon, ~20s). `pnpm rebuild better-sqlite3` and plain `pnpm rebuild` were
**silent no-ops** in a worktree — don't rely on them. It only ever affected local/worktree
runs; GitHub CI compiled it correctly on every PR, so it never blocked CI.

> The long-standing "replace `better-sqlite3` with a pure-JS / WASM SQLite" idea is now much
> lower value — v13 already removed the build step that motivated it. See the appendix note in
> [BUILD.md](./BUILD.md#appendix--post-mvp-deployment-hardening).

## Local CI mirror verification

Mirrors `.github/workflows/ci.yml` exactly. Run against `main` after merging Dependabot PRs,
or against a fix branch before pushing:

```bash
pnpm install --frozen-lockfile          # catches the duplicate-key breakage
pnpm --filter web exec prisma generate
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
```
