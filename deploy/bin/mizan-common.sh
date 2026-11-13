# Shared by Mizan's server scripts (ADR 0020), installed as /usr/local/lib/mizan/common.sh and
# sourced, never run. Constants of the layout, the root-only settings and the alert email.
# shellcheck shell=bash

MIZAN_DOMAIN=mizan.vertexmedia.pro
MIZAN_USER=vertexmizan
MIZAN_SITE=/srv/$MIZAN_DOMAIN
MIZAN_ENV=$MIZAN_SITE/shared/.env
MIZAN_FILES=$MIZAN_SITE/shared/files
MIZAN_BACKUPS=/var/backups/$MIZAN_DOMAIN
MIZAN_CONF=/etc/mizan
MIZAN_SETTINGS=$MIZAN_CONF/backup.env
MIZAN_KEYS=$MIZAN_CONF/keys
MIZAN_STATE=/var/lib/mizan-backup
MIZAN_DB=vertex_mizan
MIZAN_PG_VERSION=17
MIZAN_PG_CLUSTER=mizan
MIZAN_PG_PORT=5433
MIZAN_PG_BIN=/usr/lib/postgresql/$MIZAN_PG_VERSION/bin
MIZAN_STANZA=mizan
MIZAN_DRILL_PORT=5434
MIZAN_DRILL_DIR=/var/lib/postgresql/mizan-drill

# The keys of /etc/mizan/backup.env, all required.
MIZAN_SETTING_KEYS=(B2_REGION B2_BACKUP_BUCKET B2_BACKUP_KEY_ID B2_BACKUP_KEY B2_ARCHIVE_BUCKET
  B2_ARCHIVE_KEY_ID B2_ARCHIVE_KEY ALERT_EMAIL SMTP_URL EMAIL_FROM)

# Reads KEY=value lines of a file into shell variables without running it (values may hold any
# character). Unknown keys are ignored.
mizan_read_settings() {
  local file=$1 line key value
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || continue
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    printf -v "$key" '%s' "$value"
  done <"$file"
}

# Loads /etc/mizan/backup.env and stops when a key is missing or empty.
mizan_load_settings() {
  [ -r "$MIZAN_SETTINGS" ] || { echo "$MIZAN_SETTINGS is missing" >&2; return 1; }
  mizan_read_settings "$MIZAN_SETTINGS"
  local key
  for key in "${MIZAN_SETTING_KEYS[@]}"; do
    [ -n "${!key:-}" ] || { echo "$MIZAN_SETTINGS has no $key" >&2; return 1; }
  done
  B2_ENDPOINT=s3.$B2_REGION.backblazeb2.com
}

# restic's repository in the 35-day bucket, with its credentials in the environment only.
mizan_restic_env() {
  export RESTIC_REPOSITORY="s3:https://$B2_ENDPOINT/$B2_BACKUP_BUCKET/restic"
  export RESTIC_PASSWORD_FILE="$MIZAN_KEYS/restic.key"
  export AWS_ACCESS_KEY_ID=$B2_BACKUP_KEY_ID
  export AWS_SECRET_ACCESS_KEY=$B2_BACKUP_KEY
  export AWS_DEFAULT_REGION=$B2_REGION
}

# A psql query on the mizan cluster as postgres, one unaligned value per line.
mizan_psql() {
  runuser -u postgres -- psql -X -q -t -A -v ON_ERROR_STOP=1 -p "$MIZAN_PG_PORT" -d "${2:-$MIZAN_DB}" -c "$1"
}

# RFC 2047 for a UTF-8 header value.
mizan_mime_header() {
  printf '=?UTF-8?B?%s?=' "$(printf '%s' "$1" | base64 -w0)"
}

# Sends one plain-text email to the owner through the server's SMTP account (ADR 0008): the
# subject, then the body on stdin. The SMTP URL carries a password, so it reaches curl through its
# config on stdin, never its arguments. Returns non-zero when the email could not be sent.
mizan_send_email() {
  local subject=$1 body from_address message
  body=$(cat)
  mizan_load_settings || return 1
  from_address=$(printf '%s' "$EMAIL_FROM" | sed -n 's/.*<\([^>]*\)>.*/\1/p')
  [ -n "$from_address" ] || from_address=$EMAIL_FROM
  message=$(mktemp)
  {
    printf 'From: %s\r\n' "$EMAIL_FROM"
    printf 'To: %s\r\n' "$ALERT_EMAIL"
    printf 'Subject: %s\r\n' "$(mizan_mime_header "$subject")"
    printf 'Date: %s\r\n' "$(LC_ALL=C date -R)"
    printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n'
    printf 'Content-Transfer-Encoding: 8bit\r\n\r\n'
    printf '%s\n\n-- \n%s (%s)\n' "$body" "$(hostname -f)" "$MIZAN_DOMAIN"
  } >"$message"
  local status=0
  printf 'url = "%s"\n' "$SMTP_URL" |
    curl -sS --max-time 60 --ssl-reqd -K - --mail-from "$from_address" \
      --mail-rcpt "$ALERT_EMAIL" -T "$message" || status=$?
  rm -f "$message"
  return "$status"
}

# An alert at most once per `key` every 6 hours, also logged to the journal under mizan-alert.
mizan_alert() {
  local key=$1 subject=$2 body=$3 stamp now last
  logger -t mizan-alert "$subject: $body"
  install -d -m 700 "$MIZAN_STATE/alerts"
  stamp="$MIZAN_STATE/alerts/$key"
  now=$(date +%s)
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  [ $((now - last)) -ge 21600 ] || return 0
  if printf '%s\n' "$body" | mizan_send_email "ميزان: $subject"; then
    echo "$now" >"$stamp"
  else
    logger -t mizan-alert "the alert email could not be sent"
  fi
}

# Marks a job's success: a file whose modification time is the success.
mizan_stamp() {
  install -d -m 700 "$MIZAN_STATE"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$MIZAN_STATE/$1.ok"
}
