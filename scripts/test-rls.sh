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
#      whose N equals the number of increments and whose `then` branch raises.
#   3. Its token reaches the output through that pattern -- inserted into
#      `_harness_result` between the floor guard and `end $$`, and selected
#      back out by a final statement that is exactly the canonical one.
#   4. It does not swallow exceptions, and it runs without raising, the CLI
#      exits zero, and the token appears.
#
# Checks 1-3 are static and run before any SQL is sent. They exist because the
# runner cannot tell a passing file from one that asserted nothing by looking
# at results alone: a bare `select 'OK_x' as result;` produces byte-identical
# output to a file that ran six assertions.
#
# The static checks are written to close CLASSES, not named tricks:
#   - one quote-aware scanner decides what is code, so no comment form can
#     hide source from the checks and no string literal can be mistaken for a
#     comment;
#   - the final statement is matched exactly against the RAW file, so no
#     expression can manufacture the token;
#   - the token insert is located positionally, so it cannot sit outside the
#     block it is supposed to be gated by.
#
# What this deliberately does NOT do: judge whether an assertion is meaningful.
# `if 1 <> 1 then raise ...` satisfies every check here. No static analysis can
# close that. It is covered by requiring each policy test to be shown failing
# when its policy is dropped -- review of the tests, not this script.
set -uo pipefail

SUPABASE="npx --yes supabase@latest"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$DIR/supabase/tests/rls"
MANIFEST="$TEST_DIR/MANIFEST"
CANONICAL_LAST="select token as result from _harness_result;"
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
#
# Comparisons are -F (literal). A filename is not a regex: `0._harness_smoke.sql`
# would otherwise match the declared `00_harness_smoke.sql` and smuggle an
# undeclared file into a green run.
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
  if ! printf '%s\n' "$expected" | grep -qxF "$have"; then
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

# Blanks out everything PostgreSQL would not execute, and nothing it would.
#
# A single left-to-right scan tracking three states -- inside a '...' literal
# (with '' as an escaped quote), inside a /* */ block, or code. `--` and `/*`
# open a comment ONLY outside a string; a quote opens a string ONLY outside a
# comment. Dollar-quoted bodies need no special case: `$$` contains no quote or
# comment opener, so the scanner walks straight into the body and keeps reading
# it as the code it is.
#
# Deciding this once, correctly, is what makes the checks below hold as a
# class. Every ad-hoc filter tried before it was wrong in one direction or the
# other: truncating at `--` destroyed statements sharing a line with a literal
# containing `--`, and not truncating let a trailing `--` comment forge extra
# increments, or let a `/*` hidden inside a `--` comment open a phantom block
# that concealed the rest of the file from every check while PostgreSQL ran it.
#
# One output line per input line, so line numbers stay aligned with the source.
strip_comments() {
  awk '
    BEGIN { inblk = 0; instr = 0 }
    {
      line = $0; out = ""; i = 1; n = length(line)
      while (i <= n) {
        c = substr(line, i, 1)
        two = substr(line, i, 2)
        if (inblk) {
          if (two == "*/") { inblk = 0; i += 2 } else { i++ }
          continue
        }
        if (instr) {
          out = out c
          if (c == "'"'"'") {
            if (substr(line, i + 1, 1) == "'"'"'") { out = out "'"'"'"; i += 2; continue }
            instr = 0
          }
          i++
          continue
        }
        if (two == "--") { break }
        if (two == "/*") { inblk = 1; i += 2; continue }
        if (c == "'"'"'") { instr = 1; out = out c; i++; continue }
        out = out c
        i++
      }
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

  # A test file has no business catching exceptions. A handler around the
  # assertions converts a genuine RLS failure into a token.
  if printf '%s\n' "$src" | grep -qiE 'exception[[:space:]]+when'; then
    reject_file "contains an exception handler." \
      "A handler can swallow a failing assertion and still write the token." \
      "Let the exception propagate; that is how a test reports failure."
    ran=$((ran+1)); continue
  fi

  # No transaction control. The runner wraps every file in `begin ... rollback`
  # so fixtures never persist; a `commit;` inside the file ends that
  # transaction early and the fixtures created before it survive the run. That
  # is a real leak, not a theoretical one -- verified by making a table outlive
  # a passing test.
  #
  # `end;` is also a COMMIT synonym in SQL, but it is how every nested plpgsql
  # block closes, so matching it would reject legitimate files. Noted as a gap
  # rather than papered over.
  if printf '%s\n' "$src" | grep -qiE '(^|;)[[:space:]]*(commit|rollback|abort)[[:space:]]*(;|$)'; then
    reject_file "contains transaction control (commit/rollback/abort)." \
      "Every file runs inside a transaction this runner rolls back, so fixtures" \
      "never persist. Ending that transaction early lets them survive the run."
    ran=$((ran+1)); continue
  fi

  # The final statement, matched exactly against the RAW file. Not "contains a
  # select from _harness_result": any expression around the token --
  # coalesce(max(token), 'OK_x'), a literal, a function call -- can manufacture
  # a passing row from an empty table. The convention prescribes one exact
  # line, so require that line and nothing else.
  raw_last="$(grep -vE '^[[:space:]]*$' "$f" | tail -1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  if [ "$raw_last" != "$CANONICAL_LAST" ]; then
    reject_file "does not end with the canonical token statement." \
      "Expected the last non-blank line to be exactly:" \
      "  $CANONICAL_LAST" \
      "Found: $raw_last"
    ran=$((ran+1)); continue
  fi

  # The counter's value must come from the assertions and nothing else.
  #
  # Everything below reasons from "increments == floor" to "the assertions
  # ran". That inference only holds if the counter starts at zero and is only
  # ever advanced by an assertion. Two ordinary-looking slips break it: a
  # declaration that pre-loads the counter (`v_checks int := 9`) satisfies any
  # floor without running anything, and one with no initialiser at all leaves
  # it NULL, so `NULL < 2` is NULL rather than true and the guard never fires.
  # Neither looks adversarial; the second is a plain typo.
  decls="$(printf '%s\n' "$src" | grep -oE 'v_checks[[:space:]]+[A-Za-z][A-Za-z0-9_]*[^;]*;')"
  decl_count="$(printf '%s\n' "$decls" | grep -c 'v_checks')"

  if [ "$decl_count" -eq 0 ]; then
    reject_file "never declares its counter." \
      "Declare it as: v_checks int := 0;"
    ran=$((ran+1)); continue
  fi

  bad_decl="$(printf '%s\n' "$decls" | grep 'v_checks' | grep -vE ':=[[:space:]]*0[[:space:]]*;$' | head -1)"
  if [ -n "$bad_decl" ]; then
    reject_file "counter is not initialised to zero: $bad_decl" \
      "A pre-loaded counter clears any floor without running an assertion, and" \
      "an uninitialised one is NULL, so the floor comparison is never true." \
      "Declare it as: v_checks int := 0;"
    ran=$((ran+1)); continue
  fi

  # Count MATCHES, not matching lines: two increments on one line are two
  # assertions. Counting lines under-reports, and an author who "fixes" the
  # resulting false failure by lowering the floor installs a permanently slack
  # gate -- the exact failure this check exists to prevent.
  increments="$(printf '%s\n' "$src" | grep -oE "$inc_re" | wc -l | tr -d '[:space:]')"

  # Every assignment to the counter must BE an increment. `v_checks := 99;` or
  # `v_checks := v_checks + 5;` would otherwise move it without an assertion.
  assignments="$(printf '%s\n' "$src" | grep -oE 'v_checks[[:space:]]*:=' | wc -l | tr -d '[:space:]')"
  if [ "$assignments" -ne "$increments" ]; then
    reject_file "assigns to its counter $assignments time(s) but only $increments of those are increments." \
      "The only permitted assignment is: v_checks := v_checks + 1;" \
      "Any other assignment advances the counter without running an assertion."
    ran=$((ran+1)); continue
  fi

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

  # Where the floor guard is, where it ends, and where the block ends. These
  # positions are what bind the token to the counter; a file-wide grep for the
  # insert cannot tell "inside the guarded block" from "at top level".
  floor_line="$(printf '%s\n' "$src" | grep -nE 'v_checks[[:space:]]*<[[:space:]]*[0-9]+' | tail -1 | cut -d: -f1)"
  guard_end="$(printf '%s\n' "$src" | grep -nE 'end[[:space:]]+if[[:space:]]*;' | cut -d: -f1 | awk -v fl="$floor_line" '$1 >= fl { print; exit }')"
  block_end="$(printf '%s\n' "$src" | grep -nE '^[[:space:]]*end[[:space:]]*\$\$' | cut -d: -f1 | awk -v fl="$floor_line" '$1 > fl { print; exit }')"

  if [ -z "$guard_end" ] || [ -z "$block_end" ]; then
    reject_file "floor guard is malformed: no 'end if;' and/or no 'end \$\$' after it." \
      "The guard must be a complete if-statement inside the do-block."
    ran=$((ran+1)); continue
  fi

  # The guard's then-branch must RAISE. A `raise notice` there looks like a
  # guard and enforces nothing, removing the runtime backstop entirely.
  if ! printf '%s\n' "$src" | sed -n "${floor_line},${guard_end}p" | grep -qiE 'raise[[:space:]]+exception'; then
    reject_file "floor guard does not raise an exception." \
      "A guard that only notices is not a guard. The then-branch must be:" \
      "  raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least $floor.', v_checks;"
    ran=$((ran+1)); continue
  fi

  # Every token insert must sit between the floor guard and the end of the
  # block. One at top level, or before the guard, is not gated by the counter
  # no matter how correct the rest of the file looks.
  insert_lines="$(printf '%s\n' "$src" | grep -niE 'insert[[:space:]]+into[[:space:]]+_harness_result' | cut -d: -f1)"
  if [ -z "$insert_lines" ]; then
    reject_file "never inserts its token into _harness_result." \
      "The counter is decorative unless the token is written from inside the" \
      "block, after the floor guard: insert into _harness_result values ('$token');"
    ran=$((ran+1)); continue
  fi

  bad_insert=""
  for il in $insert_lines; do
    if [ "$il" -le "$guard_end" ] || [ "$il" -ge "$block_end" ]; then
      bad_insert="$il"
      break
    fi
  done
  if [ -n "$bad_insert" ]; then
    reject_file "inserts its token on line $bad_insert, outside the guarded region (lines $guard_end-$block_end)." \
      "The insert must sit after the floor guard's 'end if;' and before 'end \$\$'," \
      "or the counter does not gate it."
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
