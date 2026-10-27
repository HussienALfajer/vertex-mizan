#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): prepares a Claude Code cloud session. Outside the cloud
# (CLAUDE_CODE_REMOTE is not `true`) it does nothing and prints nothing. In the shared cloud
# environment `vertex`, `vertex-session` starts PostgreSQL and Mailpit, installs the dependencies,
# writes `.env` and migrates the database (docs/workflow.md, "Cloud sessions"). Always exits 0, so
# a missing tool never blocks the session.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if command -v vertex-session >/dev/null 2>&1; then
  vertex-session "${CLAUDE_PROJECT_DIR:-$(pwd)}" || true
else
  echo "Not in the 'vertex' cloud environment (no vertex-session on the PATH): the database and dependencies are not set up; see docs/workflow.md, \"Cloud sessions\"."
fi

exit 0
