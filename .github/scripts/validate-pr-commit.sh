#!/usr/bin/env bash
# Validates the single-commit PR contract enforced by the repository's GitHub Actions workflow.

set -euo pipefail

fail() {
  printf 'commit-metadata: %s\n' "$1" >&2
  exit 1
}

require_input() {
  local name="$1"
  local value="$2"

  [[ -n "$value" ]] || fail "missing required input: ${name}"
}

require_input "BASE_SHA" "${BASE_SHA:-}"
require_input "HEAD_SHA" "${HEAD_SHA:-}"

git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || fail "base commit is unavailable: ${BASE_SHA}"
git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null || fail "head commit is unavailable: ${HEAD_SHA}"

if ! merge_base="$(git merge-base "$BASE_SHA" "$HEAD_SHA")"; then
  fail "cannot determine the merge base for ${BASE_SHA} and ${HEAD_SHA}"
fi

commit_count="$(git rev-list --count "${merge_base}..${HEAD_SHA}")"
if [[ "$commit_count" != "1" ]]; then
  fail "the pull request must contain exactly one commit; found ${commit_count}"
fi

printf 'commit-metadata: validated one commit\n'
