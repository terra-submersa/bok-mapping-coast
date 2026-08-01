#!/usr/bin/env bash
#
# Scan staged changes for secrets before they enter history.
# Same tool (gitleaks) as the CI job, run locally on just the staged diff.
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  cat >&2 <<'EOF'
⚠ gitleaks is not installed — skipping secret scan on this commit.
  Install it so this check actually runs: brew install gitleaks
  (CI still scans every push, so this only weakens local feedback.)
EOF
  exit 0
fi

gitleaks protect --staged --redact --config .gitleaks.toml
