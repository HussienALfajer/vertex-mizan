#!/usr/bin/env bash
# Server setup for mizan.vertexmedia.pro (ADR 0020, docs/deployment.md). Idempotent: it creates
# what is missing and reinstalls the configuration from the repository. Run as root, streamed:
#
#   ssh vertex 'bash -s' < deploy/provision.sh            # configuration from origin/main
#   ssh vertex 'bash -s -- <ref>' < deploy/provision.sh   # from another ref
#
# Before the first run, /etc/mizan/backup.env (root, 600) holds the B2 buckets and keys, the alert
# address and the SMTP account; a run without it writes an empty one and stops. It never prints a
# secret. The database passwords, AUTH_SECRET and the three backup keys are generated here.
set -euo pipefail

DOMAIN=mizan.vertexmedia.pro
APP_USER=vertexmizan
SITE_DIR=/srv/$DOMAIN
LOG_DIR=/var/log/$DOMAIN
BACKUP_DIR=/var/backups/$DOMAIN
CONF_DIR=/etc/mizan
ACME_ROOT=/var/www/mizan-acme
REPO_URL=https://github.com/HussienALfajer/vertex-mizan.git
DB=vertex_mizan
API_PORT=3300
PG_VERSION=17
PG_CLUSTER=mizan
PG_PORT=5433
SERVER_IP=109.199.111.169
# Pinned (ADR 0020): a newer candidate stops the run until this line is changed on purpose.
PGBACKREST_VERSION=2.60.0-1.pgdg24.04+1
RESTIC_VERSION=0.16.4-2ubuntu0.24.04.3
REF=${1:-origin/main}

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
listening() { ss -ltn | awk 'NR>1{print $4}' | grep -qx "127.0.0.1:$1"; }

# The whole body is one function, so bash has read all of it before anything runs: commands
# that read stdin cannot swallow the rest of a script streamed through `ssh ... bash -s`.
main() {
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

step "Preflight"
resolved=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
[ "$resolved" = "$SERVER_IP" ] || { echo "$DOMAIN resolves to '${resolved:-nothing}', expected $SERVER_IP" >&2; exit 1; }
if listening "$API_PORT" && ! pgrep -u "$APP_USER" >/dev/null 2>&1; then
  echo "port $API_PORT is taken by another program" >&2; exit 1
fi
if listening "$PG_PORT" && ! pg_lsclusters -h | awk '{print $1"/"$2" "$3}' | grep -qx "$PG_VERSION/$PG_CLUSTER $PG_PORT"; then
  echo "port $PG_PORT is taken by another program" >&2; exit 1
fi
# A second cluster on a shared server: refuse to add it when memory is already short.
available_mb=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
if ! pg_lsclusters -h | awk '{print $1"/"$2}' | grep -qx "$PG_VERSION/$PG_CLUSTER" && [ "$available_mb" -lt 2500 ]; then
  echo "only ${available_mb} MB of memory available; the cluster needs about 1.5 GB" >&2; exit 1
fi
install -d -o root -g root -m 700 "$CONF_DIR" "$CONF_DIR/keys"
if [ ! -f "$CONF_DIR/backup.env" ]; then
  (
    umask 077
    cat >"$CONF_DIR/backup.env" <<'EOF'
# Mizan's backup and alert settings (ADR 0020), root only. Never print, commit or copy these values.
# The B2 region, e.g. eu-central-003, of both buckets.
B2_REGION=
# The 35-day bucket (pgBackRest's repo2 and restic) and its application key.
B2_BACKUP_BUCKET=
B2_BACKUP_KEY_ID=
B2_BACKUP_KEY=
# The archive bucket (Object Lock, compliance, 10 years) and its write-only key.
B2_ARCHIVE_BUCKET=
B2_ARCHIVE_KEY_ID=
B2_ARCHIVE_KEY=
# Where alerts go, and the SMTP account that sends them and the worker's email (ADR 0008).
ALERT_EMAIL=
SMTP_URL=
EMAIL_FROM=
EOF
  )
  echo "wrote an empty $CONF_DIR/backup.env: fill it in, then run provision.sh again" >&2
  exit 1
fi
chmod 600 "$CONF_DIR/backup.env"
echo "DNS ok, ports free or ours, ${available_mb} MB available"

step "Packages"
for pkg in "pgbackrest=$PGBACKREST_VERSION" "restic=$RESTIC_VERSION"; do
  name=${pkg%%=*}
  installed=$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true)
  if [ "$installed" != "${pkg#*=}" ]; then
    apt-mark unhold "$name" >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$pkg" >/dev/null
  fi
  apt-mark hold "$name" >/dev/null
done
pgbackrest version
restic version

step "System user $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
  echo "created"
fi
chmod 750 "/home/$APP_USER"

step "Directories"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$SITE_DIR" "$SITE_DIR/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SITE_DIR/shared"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$SITE_DIR/shared/files"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$LOG_DIR"
# Root's, but postgres must reach pgBackRest's local repository inside: traverse only, no listing.
install -d -o root -g root -m 711 "$BACKUP_DIR"
install -d -o postgres -g postgres -m 750 "$BACKUP_DIR/pgbackrest"
install -d -o root -g root -m 700 "$BACKUP_DIR/dumps" "$BACKUP_DIR/archive-work" /var/lib/mizan-backup
install -d -o postgres -g postgres -m 750 /var/spool/pgbackrest /var/log/pgbackrest
install -d -o root -g root -m 755 "$ACME_ROOT"

step "Repository"
if [ ! -d "$SITE_DIR/repo.git" ]; then
  runuser -u "$APP_USER" -- git init --quiet --bare "$SITE_DIR/repo.git"
  runuser -u "$APP_USER" -- git -C "$SITE_DIR/repo.git" remote add origin "$REPO_URL"
fi
runuser -u "$APP_USER" -- git -C "$SITE_DIR/repo.git" fetch --quiet --prune origin \
  '+refs/heads/*:refs/remotes/origin/*'
sha=$(runuser -u "$APP_USER" -- git -C "$SITE_DIR/repo.git" rev-parse --verify "$REF^{commit}")
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
runuser -u "$APP_USER" -- git -C "$SITE_DIR/repo.git" archive "$sha" deploy | tar -x -C "$src"
echo "configuration from ${sha:0:7}"

step "Scripts, systemd units, logrotate"
install -d -m 755 /usr/local/lib/mizan
install -m 644 "$src/deploy/bin/mizan-common.sh" /usr/local/lib/mizan/common.sh
install -m 755 "$src/deploy/bin/mizan-deploy" /usr/local/bin/mizan-deploy
install -m 755 "$src/deploy/bin/mizan-healthcheck" /usr/local/bin/mizan-healthcheck
for script in mizan-backup mizan-archive mizan-restore-drill mizan-backup-monitor mizan-alert; do
  install -m 700 "$src/deploy/bin/$script" "/usr/local/sbin/$script"
done
for unit in "$src"/deploy/systemd/*; do
  install -m 644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
install -m 644 "$src/deploy/logrotate/$DOMAIN" "/etc/logrotate.d/$DOMAIN"
systemctl daemon-reload

step "Backup keys"
# pgBackRest's repository passphrase, restic's password and the archive's key (ADR 0020, "Keys").
# Generated once; the owner keeps two copies of each. Never printed here.
for key in pgbackrest restic archive; do
  file="$CONF_DIR/keys/$key.key"
  [ -s "$file" ] || (umask 077 && openssl rand -base64 48 | tr -d '\n' >"$file" && echo "generated $key.key")
  chmod 600 "$file"
done

# shellcheck disable=SC1091
. /usr/local/lib/mizan/common.sh
mizan_load_settings

step "PostgreSQL cluster $PG_VERSION/$PG_CLUSTER"
if ! pg_lsclusters -h | awk '{print $1"/"$2}' | grep -qx "$PG_VERSION/$PG_CLUSTER"; then
  pg_createcluster "$PG_VERSION" "$PG_CLUSTER" --port "$PG_PORT" --start-conf auto \
    -- --data-checksums --encoding=UTF8 --locale=C.UTF-8 --auth-local=peer --auth-host=scram-sha-256
  echo "created"
fi
conf=/etc/postgresql/$PG_VERSION/$PG_CLUSTER
before=$(cat "$conf/conf.d/mizan.conf" "$conf/pg_hba.conf" /etc/pgbackrest/pgbackrest.conf 2>/dev/null | sha256sum)
install -o postgres -g postgres -m 644 "$src/deploy/postgresql/mizan.conf" "$conf/conf.d/mizan.conf"
install -o postgres -g postgres -m 640 "$src/deploy/postgresql/pg_hba.conf" "$conf/pg_hba.conf"

# pgBackRest's configuration holds the B2 key and the passphrase: root's, readable by postgres only.
install -d -o root -g postgres -m 750 /etc/pgbackrest
(
  umask 027
  cat >/etc/pgbackrest/pgbackrest.conf.new <<EOF
# Generated by deploy/provision.sh (ADR 0020); edit that script, not this file.
[global]
# repo1: local, the last two full backups, for fast restores.
repo1-path=$BACKUP_DIR/pgbackrest
repo1-retention-full=2
# repo2: Backblaze B2, encrypted before upload; any moment of the last 35 days.
repo2-type=s3
repo2-path=/pgbackrest
repo2-s3-endpoint=$B2_ENDPOINT
repo2-s3-region=$B2_REGION
repo2-s3-bucket=$B2_BACKUP_BUCKET
repo2-s3-key=$B2_BACKUP_KEY_ID
repo2-s3-key-secret=$B2_BACKUP_KEY
repo2-s3-uri-style=path
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=$(cat "$CONF_DIR/keys/pgbackrest.key")
repo2-retention-full-type=time
repo2-retention-full=35
compress-type=zst
process-max=2
start-fast=y
archive-async=y
spool-path=/var/spool/pgbackrest
log-level-console=info
log-level-file=detail

[$MIZAN_STANZA]
pg1-path=/var/lib/postgresql/$PG_VERSION/$PG_CLUSTER
pg1-port=$PG_PORT
pg1-socket-path=/var/run/postgresql
EOF
)
chown root:postgres /etc/pgbackrest/pgbackrest.conf.new
mv -f /etc/pgbackrest/pgbackrest.conf.new /etc/pgbackrest/pgbackrest.conf
after=$(cat "$conf/conf.d/mizan.conf" "$conf/pg_hba.conf" /etc/pgbackrest/pgbackrest.conf | sha256sum)
systemctl enable "postgresql@$PG_VERSION-$PG_CLUSTER" >/dev/null 2>&1 || true
if [ "$before" != "$after" ] || ! pg_lsclusters -h | awk '$1"/"$2=="'"$PG_VERSION/$PG_CLUSTER"'"{print $4}' | grep -qx online; then
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" restart
  echo "restarted with the new settings"
fi
pg_lsclusters | awk 'NR==1 || $2=="'"$PG_CLUSTER"'"'

step "pgBackRest stanza"
runuser -u postgres -- pgbackrest --stanza="$MIZAN_STANZA" --log-level-console=warn stanza-create
runuser -u postgres -- pgbackrest --stanza="$MIZAN_STANZA" --log-level-console=warn check
echo "both repositories accept the archive"

step "Roles, database and environment"
env_file=$SITE_DIR/shared/.env
owner_env=$SITE_DIR/shared/owner.env
db_exists=$(mizan_psql "select 1 from pg_database where datname = '$DB'" postgres)
if [ "$db_exists" != 1 ]; then
  [ ! -e "$env_file" ] || { echo "$env_file exists but database $DB does not; refusing to guess" >&2; exit 1; }
  declare -A password
  for role in mizan_owner mizan_app mizan_jobs mizan_queue; do password[$role]=$(openssl rand -hex 32); done
  # The roles of packages/db (ADR 0003, ADR 0008), as scripts/setup-local.ts makes them, without
  # CREATEDB: production makes no test databases. Through stdin: arguments are public.
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p "$PG_PORT" -d postgres <<SQL
create role mizan_owner login nosuperuser nobypassrls nocreaterole noreplication nocreatedb password '${password[mizan_owner]}';
create role mizan_app login nosuperuser nobypassrls nocreaterole noreplication nocreatedb noinherit password '${password[mizan_app]}';
create role mizan_jobs login nosuperuser nobypassrls nocreaterole noreplication nocreatedb noinherit password '${password[mizan_jobs]}';
create role mizan_queue login nosuperuser nobypassrls nocreaterole noreplication nocreatedb noinherit password '${password[mizan_queue]}';
alter role mizan_jobs set log_statement = 'all';
alter role mizan_jobs set log_parameter_max_length = 0;
create database $DB owner mizan_owner encoding 'UTF8' template template0;
revoke all on database $DB from public;
grant connect on database $DB to mizan_app, mizan_jobs, mizan_queue;
SQL
  url() { printf 'postgres://%s:%s@127.0.0.1:%s/%s' "$1" "${password[$1]}" "$PG_PORT" "$DB"; }
  (
    umask 077
    cat >"$env_file" <<EOF
# Production environment for mizan.vertexmedia.pro (generated by deploy/provision.sh).
NODE_ENV=production
LOG_LEVEL=info
API_HOST=127.0.0.1
API_PORT=$API_PORT
APP_URL=https://$DOMAIN
AUTH_SECRET=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
DATABASE_APP_URL=$(url mizan_app)
DATABASE_JOBS_URL=$(url mizan_jobs)
DATABASE_QUEUE_URL=$(url mizan_queue)
MIZAN_FILES_DIR=$SITE_DIR/shared/files
SMTP_URL=$SMTP_URL
EMAIL_FROM=$EMAIL_FROM
EOF
    # The owner role runs the migrations only, never the API or the worker (ADR 0008).
    printf 'DATABASE_OWNER_URL=%s\n' "$(url mizan_owner)" >"$owner_env"
  )
  chown "$APP_USER:$APP_USER" "$env_file" "$owner_env"
  unset password
  echo "roles, database, $env_file and $owner_env created"
else
  if [ ! -f "$env_file" ] || [ ! -f "$owner_env" ]; then
    echo "database $DB exists but $env_file or $owner_env is missing" >&2; exit 1
  fi
  echo "already set up"
fi
chmod 600 "$env_file" "$owner_env"

step "restic repository"
mizan_restic_env
if ! restic cat config >/dev/null 2>&1; then
  restic init --quiet && echo "initialized"
else
  echo "exists"
fi

step "nginx"
nginx -T 2>/dev/null | grep -q 'zone=perip:' ||
  { echo "the nginx perip zone the site uses is not defined" >&2; exit 1; }
install -m 644 "$src/deploy/nginx/mizan-headers.conf" /etc/nginx/snippets/mizan-headers.conf
install -m 644 "$src/deploy/nginx/mizan-proxy.conf" /etc/nginx/snippets/mizan-proxy.conf
install -m 644 "$src/deploy/nginx/mizan-limits.conf" /etc/nginx/conf.d/mizan-limits.conf

available=/etc/nginx/sites-available/$DOMAIN
enabled=/etc/nginx/sites-enabled/$DOMAIN
cert=/etc/letsencrypt/live/$DOMAIN/fullchain.pem

# A config that fails `nginx -t` is removed from sites-enabled at once: one broken file there
# takes every site down on the next reload or restart (SERVER.md rule 1).
activate() {
  install -m 644 "$1" "$available"
  ln -sfn "$available" "$enabled"
  if ! nginx -t 2>/tmp/mizan-nginx-test; then
    rm -f "$enabled"
    cat /tmp/mizan-nginx-test >&2
    echo "nginx rejected the configuration; the site was disabled again, other sites untouched" >&2
    exit 1
  fi
  systemctl reload nginx
}

if [ ! -f "$cert" ]; then
  activate "$src/deploy/nginx/$DOMAIN.bootstrap"
  certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" --non-interactive --keep-until-expiring
fi
activate "$src/deploy/nginx/$DOMAIN"
echo "site enabled with TLS"

step "fail2ban"
for jail in nginx-4xx-flood nginx-limit-req; do
  if fail2ban-client status "$jail" >/dev/null 2>&1; then
    fail2ban-client reload "$jail" >/dev/null && echo "$jail reloaded"
  fi
done

step "PM2 service"
systemctl enable --now pm2-vertexmizan.service
systemctl is-active pm2-vertexmizan.service

step "First backup"
# The first full backup in both repositories (ADR 0020, "Before real data", condition 2).
if ! runuser -u postgres -- pgbackrest --stanza="$MIZAN_STANZA" --repo=2 info --output=json |
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)[0]["backup"] else 1)'; then
  systemctl start mizan-backup.service
  echo "first full backup taken"
else
  echo "already taken"
fi

step "Timers"
[ -f /var/lib/mizan-backup/provisioned.ok ] || date -u +%Y-%m-%dT%H:%M:%SZ >/var/lib/mizan-backup/provisioned.ok
for timer in mizan-backup mizan-archive mizan-restore-drill mizan-backup-monitor; do
  systemctl enable --now "$timer.timer" >/dev/null
done
systemctl list-timers 'mizan-*' --no-pager

step "Chromium libraries"
# The worker prints PDFs with Playwright's Chromium (S09). Each deploy downloads the browser as
# $APP_USER; its system libraries need root, and Playwright knows the list for this release.
if [ -d "$SITE_DIR/current" ]; then
  (cd "$SITE_DIR/current" && corepack pnpm --filter @vertex-mizan/worker exec playwright install-deps chromium)
  echo "installed"
else
  echo "no release yet: run provision.sh again after the first deploy"
fi

cat <<EOF

Provisioning complete. Next:
  mizan-deploy                                       # first release
  bash -s < deploy/provision.sh                      # again, for Chromium's libraries
  systemctl enable --now mizan-health.timer          # once the first release is healthy
  systemctl start mizan-restore-drill.service        # the first drill (ADR 0020, condition 3)
The owner copies the three keys in $CONF_DIR/keys/ twice (password manager and paper).
EOF
}

main "$@"
