#!/usr/bin/env bash
# Deploys a commit of Vertex Mizan as an atomic release (ADR 0020). Runs as `vertexmizan`,
# started by /usr/local/bin/mizan-deploy (root), which always runs the latest copy of this script
# and takes the incremental backup between the two phases:
#
#   deploy.sh build [<git ref>]    build a release (default origin/main); prints RELEASE=<path>
#   deploy.sh activate <release>   migrate, switch to it, check its health, restore the previous
#                                  release if it is unhealthy
#   deploy.sh discard <release>    remove a release that was built but never activated
#   deploy.sh rollback             switch back to the previous release (migrations are not
#                                  reverted: they are backward compatible)
#
# Nothing touches the running release until the new one is built, backed up and migrated.
set -euo pipefail
umask 022

SITE_DIR=/srv/mizan.vertexmedia.pro
REPO="$SITE_DIR/repo.git"
RELEASES="$SITE_DIR/releases"
SHARED="$SITE_DIR/shared"
CURRENT="$SITE_DIR/current"
ECOSYSTEM="$CURRENT/deploy/ecosystem.config.cjs"
HEALTH_URL="http://127.0.0.1:3300/api/health"
KEEP_RELEASES=5

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export TURBO_TELEMETRY_DISABLED=1
export CI=1

log() { printf '\033[1m[deploy %s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

[ "$(id -un)" = vertexmizan ] || fail "run as vertexmizan (use /usr/local/bin/mizan-deploy)"
exec 9>"$SITE_DIR/.deploy.lock"
flock -n 9 || fail "another deploy is running"

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# The worker has no HTTP endpoint: it is online in PM2 and has stayed up.
worker_online() {
  sleep 5
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      const worker = JSON.parse(input).find((app) => app.name === "mizan-worker");
      process.exit(worker && worker.pm2_env.status === "online" ? 0 : 1);
    });'
}

# Returns non-zero instead of exiting when PM2 fails, so the caller can still restore the
# previous release (set -e does not apply inside a function called from a condition).
switch_to() {
  ln -sfn "$1" "$SITE_DIR/current.next" &&
    mv -T "$SITE_DIR/current.next" "$CURRENT" &&
    pm2 startOrReload "$ECOSYSTEM" --update-env >/dev/null &&
    pm2 save >/dev/null
}

release_path() {
  [[ "${1:-}" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || fail "expected a release name, got '${1:-}'"
  [ -d "$RELEASES/$1" ] || fail "no release $1"
  printf '%s' "$RELEASES/$1"
}

case "${1:-build}" in
rollback)
  active=$(readlink -f "$CURRENT")
  # Release names start with a UTC timestamp, so the previous one sorts just before the active one.
  previous=$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort |
    awk -v active="$active" '$0 < active' | tail -1)
  [ -n "$previous" ] || fail "no previous release to roll back to"
  log "rolling back to $(basename "$previous")"
  switch_to "$previous" || fail "PM2 could not start the previous release; check: pm2 logs"
  { healthy && worker_online; } || fail "previous release is not healthy either; check: pm2 logs"
  log "rolled back to $(basename "$previous")"
  ;;

build)
  ref="${2:-origin/main}"
  log "fetching"
  git -C "$REPO" fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*'
  sha=$(git -C "$REPO" rev-parse --verify "$ref^{commit}") || fail "unknown ref $ref"
  release="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}"
  log "building ${sha:0:7} in $(basename "$release")"
  mkdir -p "$release"
  trap 'log "removing unfinished release"; rm -rf "$release"' ERR
  git -C "$REPO" archive "$sha" | tar -x -C "$release"
  echo "$sha" >"$release/REVISION"
  ln -s "$SHARED/.env" "$release/.env"
  (
    cd "$release"
    corepack pnpm install --frozen-lockfile --reporter=append-only >&2
    # The worker's Chromium for PDFs (S09), in ~/.cache/ms-playwright; a no-op when this
    # Playwright version's browser is already there. Its libraries come from provision.sh.
    corepack pnpm --filter @vertex-mizan/worker exec playwright install chromium >&2
    corepack pnpm build >&2
  )
  trap - ERR
  echo "RELEASE=$(basename "$release")"
  ;;

discard)
  release=$(release_path "${2:-}")
  [ "$(readlink -f "$CURRENT" 2>/dev/null || true)" != "$release" ] || fail "$release is active"
  rm -rf "$release"
  log "discarded $(basename "$release")"
  ;;

activate)
  release=$(release_path "${2:-}")
  log "migrating as mizan_owner"
  # The owner role's URL lives in root's /etc/mizan/owner.env, which this user cannot read:
  # mizan-deploy opens it and hands it over on descriptor 3 for this command only, so the API, the
  # worker and the build never reach it (ADR 0008).
  owner_url=$(sed -n 's/^DATABASE_OWNER_URL=//p' <&3) || owner_url=
  exec 3<&-
  [ -n "$owner_url" ] || fail "no owner URL on descriptor 3 (run through mizan-deploy)"
  (
    cd "$release"
    export DATABASE_OWNER_URL="$owner_url"
    corepack pnpm --filter @vertex-mizan/db db:migrate >&2
  ) || fail "the migration failed; the running release is untouched (mizan-deploy discards it)"
  unset owner_url

  previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  log "switching to $(basename "$release")"
  # The worker must be online too: the API health check does not see it.
  if ! { switch_to "$release" && healthy && worker_online; }; then
    log "new release failed to start or its health check"
    if [ -n "$previous" ] && [ -d "$previous" ]; then
      if switch_to "$previous" && healthy; then
        log "restored $(basename "$previous")"
      else
        log "previous release is unhealthy too"
      fi
    fi
    fail "release $(basename "$release") is not healthy; logs: pm2 logs mizan-api --err"
  fi

  log "pruning old releases"
  active=$(readlink -f "$CURRENT")
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"$KEEP_RELEASES" |
    { grep -v -x "$active" || true; } | xargs -r rm -rf
  log "deployed $(basename "$release")"
  ;;

*)
  fail "usage: deploy.sh build [<ref>] | activate <release> | discard <release> | rollback"
  ;;
esac
