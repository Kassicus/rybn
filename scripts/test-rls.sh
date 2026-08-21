#!/usr/bin/env bash
# Runs the declared RLS test suite against a Supabase project.
#
# Each file is wrapped in a transaction that is always rolled back, so fixture
# data never persists.
#
# A file PASSES only if all of the following hold. The default is
# fail-unless-proven-passed, because this is a gate:
#
#   1. It is declared in supabase/tests/rls/MANIFEST, and every declared file
#      exists. A suite that shrank must not look like a suite that passed.
#   2. Its source uses the counter-gated pattern: a `_harness_result` temp
#      table, a `v_checks` counter, at least one increment, and a floor guard
#      whose N equals the number of increments.
#   3. Its token reaches the output through that pattern -- inserted into
#      `_harness_result` inside the block and selected back out at the end.
#      A hard-coded `select 'OK_...'` is rejected.
#   4. It runs without raising, the CLI exits zero, and the token appears.
#
# Checks 1-3 are static and run before any SQL is sent. They exist because the
# runner cannot tell a passing file from one that asserted nothing by looking
# at results alone: a bare `select 'OK_x' as result;` produces byte-identical
# output to a file that ran six assertions.
#
# What this deliberately does NOT do: judge whether an assertion is meaningful.
# `if 1 <> 1 then raise ...` satisfies every check here. No static analysis can
# close that, and pretending otherwise would be worse than the honest limit --
# it is covered by human review of the test files, not by this script.
set -uo pipefail

SUPABASE="npx --yes supabase@latest"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$DIR/supabase/tests/rls"
MANIFEST="$TEST_DIR/MANIFEST"
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

# ---------------------------------------------------------------------------
# Manifest reconciliation, before anything runs.
#
# Without this, a suite whose test files were never delivered -- or were
# deleted -- reports "1 RLS test file(s) passed" and exit 0, indistinguishable
# from a full pass. The gate could not tell "everything passed" from "almost
# nothing ran". Declaring a test is therefore a deliberate act, and both
# directions are enforced: a declared file must exist, and a present file must
# be declared (which is how a stray probe or a half-finished test slips in).
# ---------------------------------------------------------------------------
if [ ! -r "$MANIFEST" ]; then
  echo "ERROR no manifest at supabase/tests/rls/MANIFEST"
  echo "      without it a green run cannot mean the declared suite actually ran"
  echo "---"
  echo "RLS tests FAILED"
  exit 1
fi

expected="$(sed 's/#.*//' "$MANIFEST" | tr -d '[:blank:]' | grep -v '^$' | sort)"
actual="$(cd "$TEST_DIR" && ls -1 *.sql 2>/dev/null | sort)"
manifest_failed=0

for want in $expected; do
  if [ ! -f "$TEST_DIR/$want" ]; then
    echo "FAIL  $want — declared in MANIFEST but missing from supabase/tests/rls/"
    echo "      a deleted or undelivered test must not look like a passing run"
    manifest_failed=1
  fi
done

for have in $actual; do
  if ! printf '%s\n' "$expected" | grep -qx "$have"; then
    echo "FAIL  $have — present in supabase/tests/rls/ but not declared in MANIFEST"
    echo "      add it to the manifest, or delete it if it is a stray probe"
    manifest_failed=1
  fi
done

if [ "$manifest_failed" -ne 0 ]; then
  echo "---"
  echo "RLS tests FAILED"
  exit 1
fi

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

# Removes /* */ block comments (across lines) and whole-line -- comments.
#
# It deliberately does NOT truncate a code line at `--`: that is a string
# literal in `raise notice 'role switch verified -- RLS now applies';` as often
# as it is a comment, and truncating there silently drops any statement sharing
# the line. Dropping only whole-line comments needs no knowledge of string
# literals, which keeps this a filter rather than a SQL parser.
strip_comments() {
  awk '
    BEGIN { inb = 0 }
    {
      out = ""
      s = $0
      while (length(s) > 0) {
        if (inb) {
          p = index(s, "*/")
          if (p == 0) { s = "" } else { s = substr(s, p + 2); inb = 0 }
        } else {
          p = index(s, "/*")
          if (p == 0) { out = out s; s = "" }
          else { out = out substr(s, 1, p - 1); s = substr(s, p + 2); inb = 1 }
        }
      }
      t = out
      sub(/^[ \t]+/, "", t)
      if (substr(t, 1, 2) == "--") out = ""
      print out
    }
  ' "$1"
}

reject_file() {
  echo "FAIL  $name — $1"
  shift
  for hint in "$@"; do echo "      $hint"; done
  failed=1
}

for f in "$TEST_DIR"/*.sql; do
  [ -e "$f" ] || { echo "no test files found"; exit 1; }
  name="$(basename "$f")"
  token="OK_${name%.sql}"

  # Comments are stripped before every structural match. The convention header
  # in 00_harness_smoke.sql names each of these identifiers while explaining
  # them, and a block comment would otherwise be a free bypass: a file must not
  # pass by talking about the pattern instead of using it.
  src="$(strip_comments "$f")"
  inc_re='v_checks[[:space:]]*:=[[:space:]]*v_checks[[:space:]]*\+[[:space:]]*1'

  missing=""
  printf '%s\n' "$src" | grep -q '_harness_result' || missing="${missing:+$missing, }_harness_result"
  printf '%s\n' "$src" | grep -q 'v_checks'        || missing="${missing:+$missing, }v_checks"
  printf '%s\n' "$src" | grep -qE "$inc_re"        || missing="${missing:+$missing, }v_checks := v_checks + 1"

  if [ -n "$missing" ]; then
    reject_file "does not use the counter-gated pattern (missing: $missing)." \
      "A test file must write its token from inside a do-block gated on an" \
      "assertion counter, or it can report PASS having asserted nothing." \
      "See the convention header in 00_harness_smoke.sql."
    ran=$((ran+1)); continue
  fi

  # The token must travel the counter path. Without this the counter can be
  # decorative: a file may satisfy every identifier check above and still print
  # a hard-coded token that no assertion ever gated.
  if ! printf '%s\n' "$src" | grep -qiE 'insert[[:space:]]+into[[:space:]]+_harness_result'; then
    reject_file "never inserts its token into _harness_result." \
      "The counter is decorative unless the token is written from inside the" \
      "block, after the floor guard: insert into _harness_result values ('$token');"
    ran=$((ran+1)); continue
  fi

  if printf '%s\n' "$src" | grep -qiE "select[[:space:]]+'OK_"; then
    reject_file "emits a hard-coded token with a literal select." \
      "A literal 'OK_...' bypasses the counter entirely. Select it back out of" \
      "the temp table instead: select token as result from _harness_result;"
    ran=$((ran+1)); continue
  fi

  last_stmt="$(printf '%s\n' "$src" | grep -vE '^[[:space:]]*$' | tail -1)"
  if ! printf '%s\n' "$last_stmt" | grep -qiE 'select[[:space:]].*[[:space:]]from[[:space:]]+_harness_result'; then
    reject_file "does not end by selecting its token out of _harness_result." \
      "The last statement must be: select token as result from _harness_result;" \
      "Found instead: $last_stmt"
    ran=$((ran+1)); continue
  fi

  # Count MATCHES, not matching lines: two increments on one line are two
  # assertions. Counting lines under-reports, and an author who "fixes" the
  # resulting false failure by lowering the floor installs a permanently slack
  # gate -- the exact failure this check exists to prevent.
  increments="$(printf '%s\n' "$src" | grep -oE "$inc_re" | wc -l | tr -d '[:space:]')"

  if printf '%s\n' "$src" | grep -qE 'v_checks[[:space:]]*>'; then
    reject_file "writes its floor guard with '>' or '>=', which this runner does not read." \
      "Use the '<' form so the floor can be checked statically:" \
      "  if v_checks < $increments then raise exception 'HARNESS FAIL: ...'; end if;"
    ran=$((ran+1)); continue
  fi

  # Every distinct floor in the file, not just the first. Picking the first and
  # ignoring the rest would silently check the wrong guard.
  floors="$(printf '%s\n' "$src" | grep -oE 'v_checks[[:space:]]*<[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | sort -u)"
  floor_count="$(printf '%s\n' "$floors" | grep -c '[0-9]')"

  if [ "$floor_count" -eq 0 ]; then
    reject_file "has an assertion counter but no floor guard, so the counter gates nothing." \
      "Add before the token insert:" \
      "  if v_checks < $increments then raise exception 'HARNESS FAIL: ...'; end if;"
    ran=$((ran+1)); continue
  fi

  if [ "$floor_count" -gt 1 ]; then
    reject_file "has $floor_count different floor guards ($(printf '%s' "$floors" | tr '\n' ' ')), so which one gates the token is ambiguous." \
      "Use a single floor guard equal to the number of increments."
    ran=$((ran+1)); continue
  fi

  floor="$floors"

  # The floor must EQUAL the increment count. A floor below the count tolerates
  # neutered assertions; a floor above it can never pass and is a latent
  # always-fail. Both are bugs, so this is exact-equality, not >=.
  if [ "$floor" -ne "$increments" ]; then
    reject_file "counter floor is stale: floor is $floor but the file performs $increments assertion(s)." \
      "The floor must equal the number of 'v_checks := v_checks + 1' increments." \
      "A lower floor lets neutered assertions pass; a higher one can never pass."
    ran=$((ran+1)); continue
  fi

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
