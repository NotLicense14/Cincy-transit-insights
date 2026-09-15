#!/usr/bin/env bash
# Safely install (or update/remove) the GO-METRO-INSIGHTS cron block.
#
# It is a MARKER MERGE: it replaces only the lines between
# # GO-METRO-INSIGHTS-START and # GO-METRO-INSIGHTS-END in your live crontab and leaves
# every other entry untouched. Running it repeatedly leaves exactly one
# Go-Metro block (never duplicates). This automates the manual procedure
# documented in the header of cron/crontab.txt.
#
#   scripts/install-crontab.sh            install / update
#   scripts/install-crontab.sh --dry-run  print the resulting crontab, don't apply
#   scripts/install-crontab.sh --remove   strip the Go-Metro block
#
# The absolute repo path is substituted for the `/path/to/metro-insights`
# placeholder so cron's minimal environment finds bin/cron-run.sh and the
# standalone shell scripts. (Jobs run node via bin/cron-run.sh, which resolves
# `node` from cron's PATH — there is no node-path placeholder to fill.)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLOCK_FILE="$REPO/cron/crontab.txt"
PLACEHOLDER="/path/to/metro-insights"

mode="install"
case "${1:-}" in
  --dry-run) mode="dry-run" ;;
  --remove)  mode="remove" ;;
  "" )       mode="install" ;;
  *) echo "usage: install-crontab.sh [--dry-run|--remove]" >&2; exit 2 ;;
esac

if [[ ! -f "$BLOCK_FILE" ]]; then
  echo "error: cron block file not found: $BLOCK_FILE" >&2; exit 1
fi

# Live crontab (empty string if the user has none yet).
current="$(crontab -l 2>/dev/null || true)"

# Drop any existing Go-Metro block.
stripped="$(printf '%s\n' "$current" | awk '
  /^# GO-METRO-INSIGHTS-START/ {skip=1}
  /^# GO-METRO-INSIGHTS-END/    {skip=0; next}
  !skip')"

if [[ "$mode" == "remove" ]]; then
  printf '%s\n' "$stripped" | crontab -
  echo "Removed the GO-METRO-INSIGHTS cron block."
  exit 0
fi

# Render the marker block from the source-of-truth crontab with the repo path
# substituted for the placeholder. Use '#' as the sed delimiter since the paths
# contain slashes.
block="$(awk '/^# GO-METRO-INSIGHTS-START/,/^# GO-METRO-INSIGHTS-END/' "$BLOCK_FILE" \
  | sed -e "s#$PLACEHOLDER#$REPO#g")"

if [[ -z "$block" ]]; then
  echo "error: no GO-METRO-INSIGHTS-START/END block found in $BLOCK_FILE" >&2; exit 1
fi

# Append the block to whatever unrelated content remains. If the rest is
# whitespace-only (no other cron jobs), just use the block. Cron tolerates the
# odd blank line, so no fragile trailing-newline trimming is needed.
if [[ -n "${stripped//[$' \t\n']/}" ]]; then
  merged="$stripped"$'\n'"$block"
else
  merged="$block"
fi

if [[ "$mode" == "dry-run" ]]; then
  echo "----- resulting crontab (NOT applied) -----"
  printf '%s\n' "$merged"
  exit 0
fi

printf '%s\n' "$merged" | crontab -
echo "Installed the GO-METRO-INSIGHTS cron block. Active entries:"
crontab -l | awk '/^# GO-METRO-INSIGHTS-START/,/^# GO-METRO-INSIGHTS-END/'
