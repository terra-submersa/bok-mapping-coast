#!/usr/bin/env bash
#
# Validate a commit message against Conventional Commits.
# Used by both the local commit-msg hook and CI (one call per commit).
#
# Usage:
#   commit-msg-check.sh <path-to-message-file>
#   commit-msg-check.sh --string "feat: add thing"
#
set -euo pipefail

TYPES="build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test"
# type(optional scope)!: subject   e.g. "feat(core): add contour simplifier"
PATTERN="^(${TYPES})(\([a-z0-9./_-]+\))?!?: .{1,100}$"

if [[ "${1:-}" == "--string" ]]; then
  msg="${2:-}"
else
  file="${1:?usage: commit-msg-check.sh <message-file> | --string <msg>}"
  msg="$(head -1 "$file")"
fi

# Merge commits and fixup!/squash! (rebase-in-progress) are exempt.
if [[ "$msg" =~ ^Merge\  ]] || [[ "$msg" =~ ^(fixup|squash)!\  ]]; then
  exit 0
fi

if [[ "$msg" =~ $PATTERN ]]; then
  exit 0
fi

cat >&2 <<EOF
✗ Commit message does not follow Conventional Commits:

    $msg

Expected: <type>(<optional scope>): <subject>
  type = ${TYPES//|/, }
  e.g. "feat(core): add contour simplifier"
       "fix(api): handle empty Processing API response"
EOF
exit 1
