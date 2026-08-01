#!/usr/bin/env bash
#
# Point git at the repo's own hooks (.githooks) instead of .git/hooks.
# Run once per clone.
#
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
git -C "$repo_root" config core.hooksPath .githooks
chmod +x "$repo_root"/.githooks/* "$repo_root"/scripts/devsecops/*.sh

echo "==> core.hooksPath -> .githooks"
echo "    pre-commit : secret scan (gitleaks) on staged changes, blocks .env commits"
echo "    commit-msg : Conventional Commits check"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo
  echo "⚠ gitleaks not found on PATH — pre-commit secret scan will be skipped locally."
  echo "  Install it: brew install gitleaks"
fi
