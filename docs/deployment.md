# Deployment and recovery

The runbook of `mizan.vertexmedia.pro` (ADR 0020). Everything installed on the server comes from `deploy/` (`deploy/CLAUDE.md`); this file says how it is laid out, deployed, rolled back and restored. The drills and their record: `docs/operations/restore-drills.md`.

Server work is outward-facing: the owner approves provisioning, deploys, restores and deletions on the server (`AGENTS.md`, "How to work"). Read `/root/SERVER.md` on the server first.

## Location (Q7)

| Item | Value | Confidence |
|---|---|---|
| Server | the Vertex VPS (`ssh vertex`, `109.199.111.169`), shared with Vertex Hub: Contabo, Ubuntu 24.04, 6 vCPU, 11 GiB RAM, 4 GiB swap, 129 GB free disk on 2026-11-13 | CONFIRMED (read on the server, 2026-11-13) |
| Server country | France, by IP geolocation (ipinfo.io); the server's clock is `Europe/Berlin` | REPORTED |
| B2 region of both buckets | to be written here when the owner creates the buckets (`B2_REGION` in `/etc/mizan/backup.env`) | open |

The data-residency statement for customers stays open in Q7 until phase 4.

## Layout

| What | Where |
|---|---|
| Releases, the active one, shared state | `/srv/mizan.vertexmedia.pro/{releases,current,shared}`, owner `vertexmizan`; a bare clone in `repo.git` |
| Environment | `shared/.env` (600): the app, jobs and queue roles' URLs, `AUTH_SECRET`, SMTP; `shared/owner.env` (600): the owner role's URL, read by the migrations only (ADR 0008) |
| Attachments and exports | `shared/files` (`MIZAN_FILES_DIR`) |
| Processes | PM2 as `vertexmizan` (`pm2-vertexmizan.service`): `mizan-api` on `127.0.0.1:3300`, `mizan-worker` |
| Public gateway | nginx: `/etc/nginx/sites-available/mizan.vertexmedia.pro`, snippets `mizan-headers.conf` and `mizan-proxy.conf`, zones in `conf.d/mizan-limits.conf`; TLS from Let's Encrypt |
| Database | PostgreSQL 17 cluster `17/mizan` on `127.0.0.1:5433`, data in `/var/lib/postgresql/17/mizan`, settings in `/etc/postgresql/17/mizan/conf.d/mizan.conf`; database `vertex_mizan`, the four roles of `packages/db`. Hub's cluster `17/main` (5432) is separate |
| Logs | apps: `/var/log/mizan.vertexmedia.pro/{api,worker}.{out,err}.log` (30 days); nginx: `/var/log/nginx/mizan.vertexmedia.pro.*.log`; jobs: `journalctl -u mizan-<job>`; alerts: `journalctl -t mizan-alert` |
| Backups on the server | `/var/backups/mizan.vertexmedia.pro/`: `pgbackrest/` (repo1), `dumps/` (14 days of `pg_dump`) |
| Backup settings and keys | `/etc/mizan/backup.env` (B2 buckets and keys, SMTP, the alert address) and `/etc/mizan/keys/{pgbackrest,restic,archive}.key`, root only, never printed or committed; `/etc/pgbackrest/pgbackrest.conf` is generated from them |
| Scripts | `/usr/local/bin/mizan-deploy`, `mizan-healthcheck`; `/usr/local/sbin/mizan-backup`, `mizan-archive`, `mizan-restore-drill`, `mizan-backup-monitor`, `mizan-alert`; shared helpers `/usr/local/lib/mizan/common.sh` |

### Timers (UTC)

| Timer | When | Does |
|---|---|---|
| `mizan-backup` | daily 00:30 | pgBackRest to both repositories (full on Sunday, differential otherwise), the 14-day `pg_dump`, restic of the files and configuration |
| `mizan-archive` | the 2nd, 03:00 | the month just ended in Damascus: dump, files and manifest, encrypted, to the Object Lock bucket |
| `mizan-restore-drill` | the 5th, 03:30 | the monthly drill (`docs/operations/restore-drills.md`) |
| `mizan-backup-monitor` | every 5 minutes, a daily part after 06:00 | archiving, disk; daily: `pgbackrest check`, each repository's last backup, restic, the drill's and the archive's age |
| `mizan-health` | every 2 minutes | the cluster, PM2, `/api/health` locally and publicly, the certificate; restarts what it can |

Every unit's failure emails the owner through `mizan-alert@.service`. Test the email: `ssh vertex mizan-alert test`.

### Backblaze B2

Two buckets in one region, each with its own application key restricted to that bucket. The keys live only in `/etc/mizan/backup.env`.

| Bucket | Settings | Its key's capabilities |
|---|---|---|
| The 35-day bucket (pgBackRest's repo2 under `/pgbackrest`, restic under `/restic`) | private; lifecycle "keep only the last version" (hidden files deleted after a day), since pgBackRest and restic expire their own files | `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, `deleteFiles` |
| The archive bucket (`mizan/<year>/mizan-archive-<YYYY-MM>.tar.gpg`) | private; Object Lock enabled at creation, default retention **compliance, 10 years**; no lifecycle rule | `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, `readFileRetentions`; never `deleteFiles`, `writeFileRetentions`, `writeBucketRetentions` or `bypassGovernance` |

Neither key reaches the other bucket. `mizan-archive` refuses an upload whose lock is not compliance mode for 10 years.

## Provisioning

Once, then again after any change to `deploy/` other than `deploy.sh` (it is idempotent):

```bash
ssh vertex 'bash -s' < deploy/provision.sh
```

The first run writes an empty `/etc/mizan/backup.env` and stops: fill it in on the server, then run again. The run checks DNS, the ports and free memory, installs the pinned pgBackRest and restic, the user, directories, scripts, units and logrotate, generates the three backup keys, creates the `17/mizan` cluster with `deploy/postgresql/`, the pgBackRest stanza (both repositories checked), the roles, database and environment, the restic repository, the nginx site (bootstrap, certificate, then the real site; a site failing `nginx -t` is disabled at once), PM2's unit, the first full backup and the timers. It ends with the steps that follow:

```bash
ssh vertex mizan-deploy
ssh vertex 'bash -s' < deploy/provision.sh
ssh vertex systemctl enable --now mizan-health.timer
ssh vertex systemctl start mizan-restore-drill.service
```

The second provisioning installs Chromium's libraries for the worker's PDFs. Then the owner copies the three keys of `/etc/mizan/keys/` twice: into the password manager and on paper kept in a safe place (ADR 0020, "Keys"). Losing every copy of a key loses the backups it encrypted.

### Before real data (ADR 0020)

Vertex Media's production company is created (`admin:create-company`, `AGENTS.md`) only when:
1. this deployment is merged and deployed;
2. `pgbackrest --stanza=mizan --repo=2 info` lists a full backup and the monitor reports no archiving problem;
3. the first drill has passed (`journalctl -u mizan-restore-drill`) and the owner has confirmed both copies of every key.

## Deploy

```bash
ssh vertex mizan-deploy            # origin/main
ssh vertex "mizan-deploy <ref>"    # another branch, tag or commit
```

`mizan-deploy` (root) runs the latest `deploy/deploy.sh` from `origin/main` as `vertexmizan`:
1. **build**: a clean checkout into `releases/<UTC time>-<sha>`, `pnpm install --frozen-lockfile`, the build, Playwright's Chromium;
2. **backup**: an incremental pgBackRest backup to repo1, annotated `release=<name>`; a failed backup stops the deploy before anything changes;
3. **activate**: the migrations as `mizan_owner`, the switch of `current`, PM2's reload, `/api/health` and the worker checked; an unhealthy release switches back to the previous one at once.

Five releases are kept. Migrations are backward compatible (expand, then contract: `packages/db/CLAUDE.md`), so the previous release runs on the migrated database.

## Roll back

```bash
ssh vertex "mizan-deploy rollback"
```

Switches `current` to the previous release and reloads PM2. The database stays migrated. When a migration itself damaged data, restore the database to before the deploy (below) and then roll back.

## Restore

Every restore of production is decided by the owner. While it runs the books are closed: stop the apps and the jobs that touch the cluster first, and announce the window to the people using Mizan. Whatever is restored, the books are corrected only by reversals afterwards (ADR 0005): never by editing rows.

```bash
systemctl stop mizan-health.timer mizan-backup-monitor.timer mizan-backup.timer
systemctl stop pm2-vertexmizan.service
```

### The database to a moment (point-in-time recovery)

Any moment of the last 35 days from repo2 (B2), or of repo1's two full backups locally (faster). Times are UTC.

```bash
pg_ctlcluster 17 mizan stop
mv /var/lib/postgresql/17/mizan /var/lib/postgresql/17/mizan.before-restore-$(date -u +%Y%m%dT%H%M%SZ)
install -d -o postgres -g postgres -m 700 /var/lib/postgresql/17/mizan
runuser -u postgres -- pgbackrest --stanza=mizan --repo=2 --type=time \
  --target="2026-11-20 09:15:00+00" --target-action=promote restore
pg_ctlcluster 17 mizan start
```

The cluster replays the log to the target and promotes on a new timeline; its settings in `/etc/postgresql/17/mizan` are untouched. Check it before opening the books:

```bash
runuser -u postgres -- psql -p 5433 -d vertex_mizan -c "select pg_is_in_recovery(), now()"
```

then, as an owner in the app, `POST /api/integrity/check` for each company ("سلامة السلسلة"). Start the apps and timers again (`systemctl start pm2-vertexmizan.service mizan-health.timer mizan-backup-monitor.timer mizan-backup.timer`) and take a full backup at once, since the new timeline starts here:

```bash
runuser -u postgres -- pgbackrest --stanza=mizan --type=full backup
```

Keep the moved directory until the owner has accepted the restore, then remove it.

### The database to before a deploy

Each deploy's incremental backup in repo1 carries the release's name:

```bash
runuser -u postgres -- pgbackrest --stanza=mizan --repo=1 info --set=<backup label>
runuser -u postgres -- pgbackrest --stanza=mizan --repo=1 info   # lists the labels
```

Restore that backup exactly, with no log replayed past it, through the same steps as above with:

```bash
runuser -u postgres -- pgbackrest --stanza=mizan --repo=1 --set=<backup label> \
  --type=immediate --target-action=promote restore
```

then `mizan-deploy rollback` before starting PM2, so the release matches the schema. Entries committed after that backup are lost: compare with Hub's events (they are reposted by Hub's retries, idempotent by key) and the audit log before choosing this over a moment.

### One table, or old data, without a cluster restore

The daily dumps of the last 14 days are in `/var/backups/mizan.vertexmedia.pro/dumps/`. Restore what is needed into a separate database of the same cluster and read it there; production is untouched.

```bash
runuser -u postgres -- createdb -p 5433 restore_20261120
pg_restore -p 5433 -U postgres -h /var/run/postgresql -d restore_20261120 \
  --no-owner --no-privileges --table=<table> /var/backups/mizan.vertexmedia.pro/dumps/<file>.dump
runuser -u postgres -- psql -p 5433 -d restore_20261120
runuser -u postgres -- dropdb -p 5433 restore_20261120
```

Nothing read there is copied into a ledger table: a missing or wrong entry is corrected by a new entry or a reversal through the app. Settings or reference data are re-entered through the app too, so the audit log records them. Drop the database when done.

### Files and configuration

```bash
. /usr/local/lib/mizan/common.sh && mizan_load_settings && mizan_restic_env
restic snapshots --host mizan.vertexmedia.pro
restic restore <snapshot> --target /root/restore-files --include /srv/mizan.vertexmedia.pro/shared/files/<path>
```

Copy back what is needed with its owner `vertexmizan`, then remove `/root/restore-files`.

### A monthly archive

The archives outlive the 35-day window, for 10 years. A restore needs the archive key; on the server it is `/etc/mizan/keys/archive.key`, otherwise the owner's copy. On any machine with PostgreSQL 17:

1. Download the object `mizan/<year>/mizan-archive-<YYYY-MM>.tar.gpg` from the archive bucket (B2's web console, or the archive key's credentials) and compare its SHA-256 with its `x-amz-meta-sha256` metadata.
2. Decrypt and unpack:
   ```bash
   gpg --batch --decrypt --passphrase-file archive.key mizan-archive-2026-11.tar.gpg | tar -x
   cd 2026-11 && sha256sum -c <(sed -n '/  /p' manifest.txt)
   ```
3. Restore the database into a scratch cluster or database and read it: `createdb archive_2026_11 && pg_restore --no-owner --no-privileges -d archive_2026_11 database.dump`. `files.tar` holds the attachments and exports as they were. The manifest names the release that wrote them.

## Read

```bash
journalctl -u mizan-backup -n 50
journalctl -t mizan-alert -n 50
runuser -u postgres -- pgbackrest --stanza=mizan info
runuser -u postgres -- psql -p 5433 -c 'select * from pg_stat_archiver'
runuser -u vertexmizan -- env PM2_HOME=/home/vertexmizan/.pm2 pm2 status
systemctl list-timers 'mizan-*'
```
