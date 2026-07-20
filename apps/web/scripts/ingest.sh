#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"

usage() {
  echo "Usage: $0 <event-directory-or-root-directory>" >&2
}

list_event_dirs() {
  local search_root="$1"

  find "$search_root" -type f -name '*.axdb' -not -iname '*trailer*export*.axdb' -not -path '*/disabled/*' -exec dirname '{}' ';' |
    LC_ALL=C sort -u
}

list_candidates() {
  local event_dir="$1"

  find "$event_dir" -type f -name '*.axdb' -not -iname '*trailer*export*.axdb' -not -path '*/disabled/*' |
    LC_ALL=C sort
}

ingest_file() {
  local file="$1"
  local status=0

  echo "Ingesting: $file"
  (
    cd "$app_dir"
    pnpm run ingest "$file"
  ) || status=$?

  if [ "$status" -ne 0 ]; then
    echo "Error: ingest failed for $file (pnpm exit $status)" >&2
    exit "$status"
  fi
}

choose_candidate() {
  local event_dir="$1"
  shift
  local candidates=("$@")
  local combined_index=$(( ${#candidates[@]} + 1 ))
  local skip_index=$(( ${#candidates[@]} + 2 ))
  local option_count="$skip_index"
  local index=1
  local selection

  echo "Multiple .axdb files found for event directory: $event_dir" >&2
  for file in "${candidates[@]}"; do
    printf '  %d) %s\n' "$index" "$(basename "$file")" >&2
    index=$((index + 1))
  done
  printf '  %d) Ingest all (combined event)\n' "$combined_index" >&2
  printf '  %d) Skip this event\n' "$skip_index" >&2

  while true; do
    printf 'Choose file to ingest [1-%d]: ' "$option_count" >&2
    if ! IFS= read -r selection; then
      return 1
    fi

    case "$selection" in
      '')
        echo "Enter a number." >&2
        ;;
      *[!0-9]*)
        echo "Enter a valid number." >&2
        ;;
      *)
        if [ "$selection" -ge 1 ] && [ "$selection" -le "${#candidates[@]}" ]; then
          printf '%s\n' "${candidates[$((selection - 1))]}"
          return 0
        fi

        if [ "$selection" -eq "$combined_index" ]; then
          return 3
        fi

        if [ "$selection" -eq "$skip_index" ]; then
          return 2
        fi

        echo "Enter a number between 1 and $option_count." >&2
        ;;
    esac
  done
}

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

input_dir="$1"

if [ ! -d "$input_dir" ]; then
  echo "Error: '$input_dir' is not a directory" >&2
  exit 1
fi

root_dir="$(cd -- "$input_dir" && pwd)"
event_dirs="$(list_event_dirs "$root_dir")"

if [ -z "$event_dirs" ]; then
  echo "No ingestible .axdb files found under: $root_dir" >&2
  echo "Note: *Trailer Export*.axdb files are ignored by this script." >&2
  exit 1
fi

echo "Ignoring *Trailer Export*.axdb files. Each event directory will ingest at most one .axdb."

while IFS= read -r event_dir; do
  [ -n "$event_dir" ] || continue

  candidates=()
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    candidates+=("$candidate")
  done <<EOF
$(list_candidates "$event_dir")
EOF

  if [ "${#candidates[@]}" -eq 1 ]; then
    echo "Auto-selected $(basename "${candidates[0]}") for $event_dir"
    ingest_file "${candidates[0]}"
    continue
  fi

  if ! [ -t 0 ] || ! [ -t 1 ]; then
    echo "Error: multiple ingestible .axdb files found in: $event_dir" >&2
    for candidate in "${candidates[@]}"; do
      echo "  - $(basename "$candidate")" >&2
    done
    echo "Re-run interactively to choose one (or 'Ingest all (combined event)' for a same-date multi-session event), or ingest a specific file directly with: pnpm --filter web ingest <path-to-axdb>" >&2
    exit 1
  fi

  if selected_file="$(choose_candidate "$event_dir" "${candidates[@]}")"; then
    choose_status=0
  else
    choose_status=$?
  fi

  if [ "$choose_status" -eq 0 ]; then
    echo "Selected $(basename "$selected_file") for $event_dir"
    ingest_file "$selected_file"
    continue
  fi

  if [ "$choose_status" -eq 3 ]; then
    echo "Ingesting all candidates in $event_dir as a combined event (lexicographic order):"
    for candidate in "${candidates[@]}"; do
      ingest_file "$candidate"
    done
    continue
  fi

  if [ "$choose_status" -eq 2 ]; then
    echo "Skipping event directory: $event_dir"
    continue
  fi

  echo "Error: failed to read a selection for $event_dir" >&2
  exit 1
done <<EOF
$event_dirs
EOF