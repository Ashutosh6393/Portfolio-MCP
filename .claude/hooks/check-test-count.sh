#!/usr/bin/env bash
# Makes "tests are append-only" mechanical instead of advisory.
#
#   check-test-count.sh --baseline   record the count at slice start
#   check-test-count.sh              compare; non-zero if the count dropped
#
# Also wired as a Stop hook so it fires when Claude finishes a turn. Exit 2 feeds the
# message back to Claude rather than silently passing.
#
# The rule it enforces: a slice may add tests, never remove them. Deleting or skipping a
# test is the shortest path to green and produces a suite that proves nothing. Prose
# can't stop that at attempt three; a count can.

set -u

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root"

baseline_file=".claude/.test-count-baseline"

count_tests() {
  # Heuristic: counts test/it declarations across test files. Deliberately simple —
  # it needs to be stable across runs, not perfectly accurate.
  #
  # node_modules MUST stay excluded. Dependencies ship their own test files — 1849 of
  # them here against 32 of ours — so without this the count is 98% dependency noise:
  # `bun add` inflates it by thousands, `bun remove` triggers a false BLOCK, and
  # deleting every real test still leaves the total far above the baseline. That last
  # one is fatal: it is the exact failure this hook exists to catch.
  local n
  n=$(grep -rhoE '^\s*(test|it)(\.\w+)?\s*\(' \
    --include='*.test.ts' --include='*.test.tsx' \
    --include='*.spec.ts' --include='*.spec.tsx' \
    --exclude-dir=node_modules \
    . 2>/dev/null | wc -l)
  printf '%s' "${n//[^0-9]/}"
}

current=$(count_tests)

if [ "${1:-}" = "--baseline" ]; then
  mkdir -p .claude
  printf '%s' "$current" > "$baseline_file"
  echo "Test count baseline recorded: $current"
  exit 0
fi

# No baseline means no slice in progress — nothing to enforce.
[ -f "$baseline_file" ] || exit 0

baseline=$(cat "$baseline_file")

if [ "$current" -lt "$baseline" ]; then
  cat >&2 <<MSG
BLOCKED: test count dropped from $baseline to $current.

Tests are append-only within a slice. A test was deleted, skipped, or commented out.

If a test is genuinely wrong, that is a deliberate revision, not a repair:
  - only the test agent changes tests
  - log it in the Test revisions table in implementation.md with a justification
  - land it as its own commit
  - then re-baseline: bash .claude/hooks/check-test-count.sh --baseline

Restore the removed test(s) or record the revision before continuing.
MSG
  exit 2
fi

echo "Test count OK: $baseline -> $current"
exit 0
