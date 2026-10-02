#!/usr/bin/env bash
# Deterministic Dependabot merge loop for this repo. Encodes the routine path of
# docs/dependabot.md; everything off that path stops and reports instead of guessing.
#
#   dependabot-merge.sh [status]                         read-only table of open Dependabot PRs
#   dependabot-merge.sh merge [--dry-run] [--include-majors]
#   dependabot-merge.sh verify                           local CI mirror on a temp worktree of origin/main
#
# Needs authenticated `gh` and `jq` — run outside the sandbox.
set -euo pipefail

REPO="${REPO:-alchemydc/launchcontrol}"
POLL_SECS="${POLL_SECS:-30}"
PR_TIMEOUT_SECS="${PR_TIMEOUT_SECS:-1200}"
MAX_REBASES="${MAX_REBASES:-3}"

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { log "STOP: $*"; exit 1; }

# Open Dependabot PR numbers, ascending.
list_prs() {
  gh pr list --repo "$REPO" --state open --author app/dependabot --limit 100 \
    --json number --jq '.[].number' | sort -n
}

pr_json() {
  gh pr view "$1" --repo "$REPO" \
    --json number,title,body,state,isDraft,headRefOid,mergeStateStatus,files
}

# "<status>/<conclusion>" of the `web` check run on a specific commit, or "none".
web_check() {
  local out
  out=$(gh api "repos/$REPO/commits/$1/check-runs?check_name=web" \
    --jq '.check_runs | sort_by(.started_at) | last | if . == null then "none" else "\(.status)/\(.conclusion // "-")" end')
  echo "${out:-none}"
}

# yes if any "from A to B" in title/body crosses a leading version number.
is_major() {
  jq -r '[(.title + "\n" + (.body // "")) | scan("from v?([0-9]+)\\.[^ ]* to v?([0-9]+)\\.")
          | select(.[0] != .[1])] | if length > 0 then "yes" else "no" end' <<<"$1"
}

# NONLOCK | LOCK | FM3 | RED
classify() {
  local json=$1 web=$2 lock pkg
  lock=$(jq '[.files[].path] | index("pnpm-lock.yaml") != null' <<<"$json")
  pkg=$(jq '[.files[].path] | any(endswith("package.json"))' <<<"$json")
  # FM3 first: those PRs are always red, and the remedy differs from a real failure.
  if [[ $pkg == true && $lock == false ]]; then
    echo FM3
  elif [[ $web == completed/* && $web != completed/success && $web != completed/skipped ]]; then
    echo RED
  elif [[ $lock == true ]]; then
    echo LOCK
  else
    echo NONLOCK
  fi
}

cmd_status() {
  local n json sha web
  printf '%-5s %-8s %-9s %-22s %-5s %s\n' PR CLASS STATE WEB MAJOR TITLE
  for n in $(list_prs); do
    json=$(pr_json "$n")
    sha=$(jq -r .headRefOid <<<"$json")
    web=$(web_check "$sha")
    printf '%-5s %-8s %-9s %-22s %-5s %s\n' "$n" "$(classify "$json" "$web")" \
      "$(jq -r .mergeStateStatus <<<"$json")" "$web" "$(is_major "$json")" "$(jq -r .title <<<"$json")"
  done
}

# Rebase until current, wait for a fresh `web` pass on the new head, merge.
merge_one() {
  local n=$1 deadline rebases=0 requested_for="" json state mss sha web
  deadline=$(( $(date +%s) + PR_TIMEOUT_SECS ))
  log "#$n: start"
  while :; do
    (( $(date +%s) < deadline )) || die "#$n: timed out after ${PR_TIMEOUT_SECS}s (rebase refused? see docs/dependabot.md failure mode 1)"
    json=$(pr_json "$n")
    state=$(jq -r .state <<<"$json")
    mss=$(jq -r .mergeStateStatus <<<"$json")
    sha=$(jq -r .headRefOid <<<"$json")
    case $state in
      MERGED) log "#$n: merged"; return 0 ;;
      CLOSED) log "#$n: closed by someone else, skipping"; return 0 ;;
    esac
    web=$(web_check "$sha")
    case $web in
      completed/success)
        case $mss in
          CLEAN)
            log "#$n: CLEAN + web success on ${sha:0:7}, merging"
            # A race (another PR landed) makes this fail; the next poll sees BEHIND.
            gh pr merge "$n" --repo "$REPO" --merge || log "#$n: merge refused, re-polling" ;;
          BEHIND|DIRTY)
            if [[ $requested_for != "$sha" ]]; then
              (( rebases < MAX_REBASES )) || die "#$n: still $mss after $MAX_REBASES rebases"
              rebases=$((rebases + 1))
              log "#$n: $mss, requesting rebase $rebases/$MAX_REBASES"
              gh pr comment "$n" --repo "$REPO" --body "@dependabot rebase" >/dev/null
              requested_for=$sha
            fi ;;
          UNSTABLE) die "#$n: web passed but another check failed (UNSTABLE)" ;;
          *) log "#$n: $mss, waiting" ;;
        esac ;;
      completed/*) die "#$n: web check $web on ${sha:0:7} — fix or skip by hand" ;;
      *)
        # Pending or absent. A BEHIND PR with no run on its head still needs the rebase.
        if [[ $mss == BEHIND || $mss == DIRTY ]] && [[ $web == none && $requested_for != "$sha" ]]; then
          (( rebases < MAX_REBASES )) || die "#$n: still $mss after $MAX_REBASES rebases"
          rebases=$((rebases + 1))
          log "#$n: $mss with no web run, requesting rebase $rebases/$MAX_REBASES"
          gh pr comment "$n" --repo "$REPO" --body "@dependabot rebase" >/dev/null
          requested_for=$sha
        else
          log "#$n: $mss, web $web on ${sha:0:7}, waiting"
        fi ;;
    esac
    sleep "$POLL_SECS"
  done
}

cmd_merge() {
  local dry=false majors=false n json web class major
  local -a nonlock=() lock=()
  for arg in "$@"; do
    case $arg in
      --dry-run) dry=true ;;
      --include-majors) majors=true ;;
      *) die "unknown merge flag: $arg" ;;
    esac
  done
  for n in $(list_prs); do
    json=$(pr_json "$n")
    web=$(web_check "$(jq -r .headRefOid <<<"$json")")
    class=$(classify "$json" "$web")
    major=$(is_major "$json")
    if [[ $(jq -r .isDraft <<<"$json") == true ]]; then log "#$n: skip (draft)"; continue; fi
    case $class in
      FM3) log "#$n: skip (FM3: package.json without lockfile — merge the grouped PR with the same version)"; continue ;;
      RED) log "#$n: skip (RED: web $web — needs a human)"; continue ;;
    esac
    if [[ $major == yes && $majors == false ]]; then log "#$n: skip (major bump — review, then rerun with --include-majors)"; continue; fi
    if [[ $class == NONLOCK ]]; then nonlock+=("$n"); else lock+=("$n"); fi
  done
  log "order: NONLOCK [${nonlock[*]:-}] then LOCK [${lock[*]:-}]"
  $dry && { log "dry run, nothing changed"; return 0; }
  for n in "${nonlock[@]}" "${lock[@]}"; do
    merge_one "$n"
  done
  log "done; run '$0 verify' to check main"
}

cmd_verify() {
  local root wt logf rc=0
  root=$(git rev-parse --show-toplevel)
  wt=$(mktemp -d "${TMPDIR:-/tmp}/dependabot-verify.XXXXXX")
  logf="$wt.log"
  # shellcheck disable=SC2064
  trap "git -C '$root' worktree remove --force '$wt' >/dev/null 2>&1 || true" EXIT
  git -C "$root" fetch origin main
  git -C "$root" worktree add --detach "$wt" origin/main >/dev/null
  log "verifying origin/main @ $(git -C "$wt" rev-parse --short HEAD) in $wt (log: $logf)"
  (
    cd "$wt"
    set -x
    pnpm install --frozen-lockfile
    pnpm --filter web exec prisma generate
    pnpm --filter web lint
    pnpm --filter web typecheck
    pnpm --filter web test
    pnpm --filter web build
  ) 2>&1 | tee "$logf" || rc=$?
  if grep -q ERR_PNPM_BROKEN_LOCKFILE "$logf"; then
    die "broken lockfile on main — follow docs/dependabot.md failure mode 1 (do not @dependabot rebase)"
  fi
  (( rc == 0 )) || die "local CI mirror failed (exit $rc), see $logf"
  log "main is healthy"
}

case "${1:-status}" in
  status) cmd_status ;;
  merge) shift; cmd_merge "$@" ;;
  verify) cmd_verify ;;
  *) die "usage: $0 [status | merge [--dry-run] [--include-majors] | verify]" ;;
esac
