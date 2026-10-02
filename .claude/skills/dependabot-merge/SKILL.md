---
name: dependabot-merge
description: Merge this repo's open Dependabot PRs deterministically — classify them, land non-lockfile PRs first, then lockfile PRs one at a time (rebase, fresh `web` pass on the new head, merge), then verify main with the local CI mirror. Use when asked to merge, land, process, or clear Dependabot PRs, dependency bumps, or dependency PRs.
---

# Dependabot merge

`docs/dependabot.md` is the source of truth; read it if anything below is unclear. This skill drives the routine path with `dependabot-merge.sh` (next to this file) and leaves every judgment call to you and the user.

## Rules

- Run the script and every `gh` call **outside the sandbox** (authenticated `gh` doesn't work inside it).
- Never `gh pr merge --admin` or otherwise bypass branch protection on a PR that touches `pnpm-lock.yaml`. Never force-push.
- Never comment `@dependabot rebase` on a failure mode 1 (broken lockfile) or failure mode 3 (package.json without lockfile) PR. It comes back in the same shape.

## Procedure

1. **Status** (read-only): `.claude/skills/dependabot-merge/dependabot-merge.sh status`. Show the user the table. Classes:
   - `NONLOCK`: no lockfile change (Actions/workflow bumps). These merge first.
   - `LOCK`: touches `pnpm-lock.yaml`. These merge strictly one at a time.
   - `FM3`: changes `package.json` but not the lockfile (a security PR scoped to `/apps/web`). The script skips it. Find the green grouped PR carrying the same version and merge that instead. Dependabot then closes the FM3 PR on its own.
   - `RED`: the `web` check failed on the current head. The script skips it. Read the failing log and report. A major bump hitting a held-major reason (eslint 10, TypeScript 7, react-table 9) means the `ignore:` list needs a look, not a fix.
   - `MAJOR=yes`: skipped unless `--include-majors`. Review the changelog with the user first.
2. **Dry run**: `... merge --dry-run`. Confirm the order and skips with the user.
3. **Merge**: `... merge` (add `--include-majors` only if the user approved specific majors). This polls for minutes per PR, so run it in the background and wait for it to exit. It stops non-zero on a red check, `UNSTABLE`, too many rebases, or a timeout. Report the stop reason; don't loop on it.
   - A timeout with the head SHA unchanged usually means Dependabot refused to rebase. Check the PR's comments for a lockfile parse error, which is failure mode 1.
4. **Verify**: `... verify` runs the local CI mirror on a temp worktree of `origin/main`. If it reports `ERR_PNPM_BROKEN_LOCKFILE`, follow failure mode 1 in the doc by hand (rebuild the lockfile on a fix branch, open a superseding PR, close the stuck ones).

Tunables (env): `POLL_SECS` (30), `PR_TIMEOUT_SECS` (1200), `MAX_REBASES` (3), `REPO`.
