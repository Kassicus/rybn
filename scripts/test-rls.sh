#!/usr/bin/env bash
# Runs every RLS test file against a Supabase project.
#
# Each file is wrapped in a transaction that is always rolled back, so fixture
# data never persists.
#
# A file PASSES only by printing its success token -- `OK_<basename-without-.sql>`
# -- as the result of its final statement. Anything else is a failure: a raised
# exception, a non-zero exit from the CLI, or a file that ran but asserted
# nothing. The default is fail-unless-proven-passed, because this is a gate.
set -uo pipefail

SUPABASE="npx --yes supabase@latest"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed=0
ran=0

# Which project the tests run against.
#
# By default the CLI's linked project (`supabase link` writes the ref to
# supabase/.temp/project-ref, which is machine-local and untracked).
# SUPABASE_PROJECT_REF overrides that for a single run without re-linking --
# useful for pointing at a scratch or staging project, or on a machine that has
# no link. The effective target is printed before the first test: these tests
# assert on real data, so silently running them against the wrong database
# would produce a meaningless verdict in either direction.
TARGET=(--linked)
LINK_FILE="$DIR/supabase/.temp/project-ref"
if [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  TARGET+=(--project-ref "$SUPABASE_PROJECT_REF")
  target_ref="$SUPABASE_PROJECT_REF"
  target_src="via SUPABASE_PROJECT_REF"
elif [ -r "$LINK_FILE" ]; then
  target_ref="$(cat "$LINK_FILE")"
  target_src="via --linked, from supabase/.temp/project-ref"
else
  target_ref="UNKNOWN"
  target_src="via --linked, but no local link found -- run: npx supabase link --project-ref <ref>"
fi
echo "target: $target_ref ($target_src)"

# Combined stdout+stderr of the most recent CLI invocation, plus its exit
# status. A file, not a command substitution, so run_with_retry executes in
# this shell and can report the exit status rather than only the text.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
OUT_FILE="$WORK_DIR/out"
CLI_RC=0
UNREACHABLE=97

# True when the CLI never reached the target database -- it fails at
# "Initialising login role" with LegacyDbConfigLoginRoleStatusError /
# "Failed to create login role" before any SQL is sent.
#
# This is NOT a failing assertion, so it must never be reported as one: a
# correct schema would look broken. It is usually also NOT transient. The
# common causes are permanent until someone acts -- the project is paused, the
# linked ref is wrong or stale, or there is no link at all. The retries below
# cover a genuinely momentary blip only; if they are exhausted, check
# `npx supabase projects list` for the target's status before assuming the
# database was merely slow.
is_unreachable() {
  echo "$1" | grep -qE 'LoginRole|Failed to create login role|connection timeout|ECONNRESET|EAI_AGAIN|socket hang up'
}

# Runs $1 against the target. Writes combined output to $OUT_FILE and sets
# CLI_RC to the CLI's exit status. Returns 0 once a verdict was obtained,
# or $UNREACHABLE if the target stayed unreachable for every attempt.
run_with_retry() {
  local sql="$1" attempt=1
  while [ "$attempt" -le 4 ]; do
    $SUPABASE db query "$sql" "${TARGET[@]}" > "$OUT_FILE" 2>&1
    CLI_RC=$?
    if is_unreachable "$(cat "$OUT_FILE")"; then
      [ "$attempt" -lt 4 ] && sleep $((attempt * 5))
      attempt=$((attempt+1))
      continue
    fi
    return 0
  done
  return "$UNREACHABLE"
}

for f in "$DIR"/supabase/tests/rls/*.sql; do
  [ -e "$f" ] || { echo "no test files found"; exit 1; }
  name="$(basename "$f")"
  token="OK_${name%.sql}"

  # Real newlines around the file's contents. Command substitution strips the
  # trailing newline, so `; rollback;` appended on the same line would land
  # inside a trailing `--` comment and silently disable the rollback, letting
  # fixtures persist.
  sql="begin;"$'\n'"$(cat "$f")"$'\n'"rollback;"

  run_with_retry "$sql"
  rc=$?
  out="$(cat "$OUT_FILE")"

  if [ "$rc" -eq "$UNREACHABLE" ]; then
    echo "ERROR $name — could not reach $target_ref after 4 attempts (no SQL ran; this is not a test result)"
    echo "      check \`npx supabase projects list\`: a paused project or a stale ref will not recover on retry"
    echo "$out" | sed 's/^/      /' | head -5
    failed=1
  elif echo "$out" | grep -qE '"_tag": *"Error"|FAIL:|HARNESS FAIL|RLS FAIL|OVERRIDE FAIL|PROVISIONING FAIL'; then
    echo "FAIL  $name"
    echo "$out" | sed 's/^/      /' | head -20
    failed=1
  elif [ "$CLI_RC" -ne 0 ]; then
    echo "FAIL  $name — CLI exited $CLI_RC with unrecognised output (treated as a failure, never a pass)"
    echo "$out" | sed 's/^/      /' | head -20
    failed=1
  elif ! echo "$out" | grep -qF "$token"; then
    echo "FAIL  $name — did not emit its success token '$token'"
    echo "      the file ran without raising but never proved it asserted anything;"
    echo "      see 00_harness_smoke.sql: count the assertions, then emit '$token' from"
    echo "      inside the block only after the count clears its floor"
    echo "$out" | sed 's/^/      /' | head -20
    failed=1
  else
    echo "PASS  $name"
  fi
  ran=$((ran+1))
done

echo "---"
if [ "$failed" -eq 0 ]; then
  echo "$ran RLS test file(s) passed"
else
  echo "RLS tests FAILED"
fi
exit "$failed"
