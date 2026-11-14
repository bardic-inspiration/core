#!/bin/bash
# SessionStart hook: prepares a cloud session so `check` can run
# (AGENTS.md "Commands"). Runs only in Claude Code on the web; a local machine
# is set up by hand (CONTRIBUTING.md).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# The container is cached once this hook completes, so `npm install` (which
# reuses what's there) rather than `npm ci`. Chromium for the browser test is
# preinstalled in cloud containers.
npm install --no-audit --no-fund
