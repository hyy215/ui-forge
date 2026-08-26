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

section_has_nonempty_item() {
  local heading="$1"
  local stop_prefix="$2"
  local in_section=false
  local line
  local item

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$heading" ]]; then
      in_section=true
      continue
    fi

    if [[ "$in_section" == true ]]; then
      if [[ -n "$stop_prefix" && "$line" == "$stop_prefix"* ]]; then
        break
      fi

      if [[ "$line" == "- "* ]]; then
        item="${line#- }"
        [[ -n "$item" ]] && return 0
      fi
    fi
  done <<< "$commit_message"

  return 1
}

require_input "PR_URL" "${PR_URL:-}"
require_input "BASE_SHA" "${BASE_SHA:-}"
require_input "HEAD_SHA" "${HEAD_SHA:-}"

if [[ ! "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]]; then
  fail "PR_URL is not a canonical GitHub pull request URL: ${PR_URL}"
fi

git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || fail "base commit is unavailable: ${BASE_SHA}"
git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null || fail "head commit is unavailable: ${HEAD_SHA}"

if ! merge_base="$(git merge-base "$BASE_SHA" "$HEAD_SHA")"; then
  fail "cannot determine the merge base for ${BASE_SHA} and ${HEAD_SHA}"
fi

commit_count="$(git rev-list --count "${merge_base}..${HEAD_SHA}")"
if [[ "$commit_count" != "1" ]]; then
  fail "the pull request must contain exactly one commit; found ${commit_count}"
fi

commit_message="$(git show -s --format=%B "$HEAD_SHA")"

section_has_nonempty_item "修改方案：" "PR:" || \
  fail "commit message must contain 修改方案： followed by a non-empty list item"

pr_line_count=0
matching_pr_line_count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "PR:"* ]]; then
    pr_line_count=$((pr_line_count + 1))
    if [[ "$line" == "PR: ${PR_URL}" ]]; then
      matching_pr_line_count=$((matching_pr_line_count + 1))
    fi
  fi
done <<< "$commit_message"

if [[ "$pr_line_count" != "1" || "$matching_pr_line_count" != "1" ]]; then
  fail "commit message must contain exactly one PR: line matching ${PR_URL}"
fi

printf 'commit-metadata: validated one commit with matching plan and PR URL\n'
