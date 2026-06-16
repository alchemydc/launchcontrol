# Dependabot runbook

Merging Dependabot PRs in this repo has repeatedly gotten stuck and required manual
surgery (#23, #54, #64). This doc explains the preventive config now in place and gives
exact recovery recipes for the two failure modes that still bite.

The app is a pnpm workspace (`apps/web`, pnpm `10.25.0`). CI (`.github/workflows/ci.yml`,
the **`web`** check) runs `pnpm install --frozen-lockfile` → prisma generate → lint →
typecheck → test → build.

## TL;DR

- Merge Dependabot PRs one at a time; **let each rebase onto latest `main` and re-pass CI
  before merging** (branch protection now enforces this).
- If `main` ends up with `ERR_PNPM_BROKEN_LOCKFILE … duplicated mapping key`, see
  [Failure mode 1](#failure-mode-1--broken-lockfile-duplicate-keys).
- If tests fail with `Could not locate the bindings file … better_sqlite3.node`, run
  `pnpm install --force`. See [Failure mode 2](#failure-mode-2--better-sqlite3-native-binary).

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
3. **Repo settings:** `allow_auto_merge` and `delete_branch_on_merge` are on. You can queue a
   Dependabot PR to merge automatically once strict CI passes (`gh pr merge <n> --auto
   --merge`, or comment `@dependabot merge`), and merged branches are cleaned up.

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

## Failure mode 2 — better-sqlite3 native binary

`better-sqlite3` is a native addon (listed under `onlyBuiltDependencies` in
`pnpm-workspace.yaml`, so its build is pre-approved). After a version bump or in a fresh git
worktree, a cached `pnpm install` may link the package **without compiling** the new
`better_sqlite3.node`.

**Symptom:**

```
Error: Could not locate the bindings file. Tried:
 → …/better-sqlite3@<ver>/…/build/Release/better_sqlite3.node
 …
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 pretest: …
```

**Fix:** `pnpm install --force` (forces a real reinstall that runs build scripts → compiles
the addon, ~20s). Verify:

```bash
ls node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

`pnpm rebuild better-sqlite3` and plain `pnpm rebuild` were **silent no-ops** in a worktree —
don't rely on them. This only affects local/worktree runs; GitHub CI compiles it correctly on
every PR, so it never blocks CI.

> Long-term, replacing `better-sqlite3` with a pure-JS / WASM SQLite (no native build step)
> would remove this failure mode entirely. Tracked separately.

## Local CI mirror verification

Mirrors `.github/workflows/ci.yml` exactly. Run against `main` after merging Dependabot PRs,
or against a fix branch before pushing:

```bash
pnpm install --frozen-lockfile          # catches the duplicate-key breakage
pnpm --filter web exec prisma generate
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test                  # if better_sqlite3.node missing → pnpm install --force
pnpm --filter web build
```
