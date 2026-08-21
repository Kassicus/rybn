#!/usr/bin/env bash
# Runs every RLS test file against the linked Supabase project.
# Each file is wrapped in a transaction that is always rolled back, so
# fixture data never persists. A file signals failure by RAISE EXCEPTION.
set -uo pipefail

SUPABASE="npx --yes supabase@latest"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed=0
ran=0

# Target the linked project by default. SUPABASE_PROJECT_REF overrides which
# project is queried WITHOUT re-linking (it does not touch supabase/.temp).
# This exists because the committed link in supabase/.temp/project-ref points
# at "rybn" (atzrokpgttmzgbawbzst), which is PAUSED/INACTIVE, while the project
# the app actually talks to per .env.local is "Rybn" (xomvbdvvrlbxoyqdsstt).
# Until that is reconciled, run: SUPABASE_PROJECT_REF=<ref> npm run test:rls
TARGET=(--linked)
if [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  TARGET+=(--project-ref "$SUPABASE_PROJECT_REF")
fi

# The Supabase CLI intermittently fails before it ever reaches the database,
# with LegacyDbConfigLoginRoleStatusError / "Failed to create login role".
# That is infrastructure flakiness, NOT a failing assertion -- treating it as
# a test failure would report a correct schema as broken. Retry those;
# fail only on an exception raised by the test SQL itself.
is_infra_error() {
  echo "$1" | grep -qE 'LoginRole|Failed to create login role|connection timeout|ECONNRESET|EAI_AGAIN|socket hang up'
}

run_with_retry() {
  local sql="$1" attempt=1 out
  while [ "$attempt" -le 4 ]; do
    out=$($SUPABASE db query "$sql" "${TARGET[@]}" 2>&1)
    if is_infra_error "$out"; then
      [ "$attempt" -lt 4 ] && sleep $((attempt * 5))
      attempt=$((attempt+1))
      continue
    fi
    printf '%s' "$out"
    return 0
  done
  printf 'INFRA_UNAVAILABLE %s' "$out"
  return 2
}

for f in "$DIR"/supabase/tests/rls/*.sql; do
  [ -e "$f" ] || { echo "no test files found"; exit 1; }
  name="$(basename "$f")"
  sql="begin; $(cat "$f") ; rollback;"

  out=$(run_with_retry "$sql")
  rc=$?

  if [ "$rc" -eq 2 ]; then
    echo "ERROR $name — database unreachable after 4 attempts (infrastructure, not a test failure)"
    echo "$out" | sed 's/^/      /' | head -5
    failed=1
  elif echo "$out" | grep -qE '"_tag": *"Error"|FAIL:|HARNESS FAIL|RLS FAIL|OVERRIDE FAIL|PROVISIONING FAIL'; then
    echo "FAIL  $name"
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
