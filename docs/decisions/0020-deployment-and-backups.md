# 0020 — Deployment and backups: the shared server, a PostgreSQL cluster of Mizan's own, point-in-time recovery and encrypted off-server copies

Status: Accepted (owner, 2026-11-13) · Date: 2026-11-13 · Refines [0002](0002-stack-and-repository.md) ("Hosting") · Closes open question Q2

## Context
ADR 0002 places Mizan on the existing Vertex server beside Hub, behind nginx with PM2, at `mizan.vertexmedia.pro`, and requires a deployment ADR before the first production deploy. Open question Q2 asked for off-server backups: Hub keeps a daily `pg_dump` on the server only, for 14 days (Hub ADR 0034), but Mizan's ledger must be kept at least 10 years (`AGENTS.md`), and a loss of the server or its disk would lose the books with their backups. The roadmap holds real company data until this ADR is in force.

What has to be decided:
- where Mizan runs on the server, and how its database is separated from Hub's;
- how much data a failure may lose, and how a restore reaches a chosen moment;
- where the copies live off the server, how they are encrypted, who holds the keys, and how long they are kept;
- how a restore is proven to work;
- what must be true before Vertex Media's production company is created.

The server is the owner's Ubuntu 24.04 VPS of Hub ADR 0009 (6 vCPU, about 11 GB RAM, about 174 GB free disk on 2026-09-28; Node 24, PostgreSQL 17, nginx, PM2, no Docker). These figures and the server's country are UNVERIFIED for this ADR: the server was not reachable from the session that wrote it (2026-11-13), and the deployment PR reads them from the server and `/root/SERVER.md` before provisioning.

## Decision

### Layout on the server (the server's conventions, Hub ADR 0009)
- A system user `vertexmizan` with its own PM2 service; processes `mizan-api` (listening on `127.0.0.1:3300` only) and `mizan-worker`. nginx is the only public gateway: it serves `apps/web`'s build and proxies `/api` and `/v1` to the API, with TLS from Let's Encrypt.
- Code in `/srv/mizan.vertexmedia.pro/{releases,current,shared}`; the environment in `shared/.env` (owner `vertexmizan`, mode 600); attachments and exports in `shared/files` (`MIZAN_FILES_DIR`); app logs in `/var/log/mizan.vertexmedia.pro/`; local backups in `/var/backups/mizan.vertexmedia.pro/` (root, mode 700).
- Everything on the server comes from `deploy/` in this repository (provisioning, the deploy script, systemd units, nginx site, logrotate), copied and adapted from Hub's `deploy/`. Deploys never run as root and never edit files on the server by hand.
- A deploy builds the release, takes an incremental backup (below), applies the migrations as `mizan_owner`, then switches `current` and reloads PM2. Migrations stay backward compatible (expand, then contract), so a rollback runs the previous release against the migrated database.
- Chromium's system dependencies are installed for the worker's PDFs; email goes through the owner's SMTP account (ADR 0008).

### A PostgreSQL cluster of Mizan's own
- Mizan runs in a second PostgreSQL 17 cluster on the same server (`pg_createcluster 17 mizan`, listening on `127.0.0.1:5433` only), not in Hub's cluster.
- Write-ahead-log archiving and point-in-time recovery are per cluster: in its own cluster a restore of Mizan to a moment never rolls Hub back, and Hub's restores never touch the books. The two products share no role, extension upgrade or restart.
- The four roles of `packages/db` (`mizan_owner`, `mizan_app`, `mizan_jobs`, `mizan_queue`) exist only in this cluster. Mizan has no database access to Hub's cluster, and Hub none to Mizan's (ADR 0002): they meet only through the `/v1` API.
- The cluster's memory settings are sized for the shared server (a `shared_buffers` of about 1 GB to start), reviewed after the first real month.

### Backups: point-in-time recovery with pgBackRest
- pgBackRest backs up the cluster: a full backup every Sunday, a differential backup every other day, an incremental one before each deploy, and continuous archiving of the write-ahead log with `archive_timeout` of 60 seconds.
- **Recovery point:** at most about one minute of committed entries is lost on a total loss of the server. **Recovery time target:** the books answer again within four hours of the decision to restore.
- Two repositories:
  1. local, in `/var/backups/mizan.vertexmedia.pro/pgbackrest`, the last two full backups and their logs, for fast restores;
  2. **Backblaze B2** (S3-compatible), the off-server repository, encrypted by pgBackRest (`aes-256-cbc`) before upload.
- **Retention off the server:** any moment of the last **35 days** can be restored (one closed month and its close, with margin). pgBackRest expires older backups and logs in that repository.
- A daily `pg_dump` in custom format is kept locally for 14 days, as Hub's, for restoring a single table or reading old data without a cluster restore.

### Monthly archives for 10 years
- On the 2nd of each month (after the month ends in Damascus), a systemd timer takes a `pg_dump` of the database and a snapshot of `shared/files`. It encrypts both, with their checksums and the deployed revision, and uploads them to a second B2 bucket used only for archives.
- That bucket has **Object Lock** in compliance mode for **10 years** from each upload, and the server's key for it can write but cannot delete or shorten a lock. A compromised server cannot erase the archives, and no one can delete one before its 10 years end.
- The 35-day bucket's key cannot reach the archive bucket, and the archive bucket's key cannot reach the 35-day bucket.
- The books themselves stay in the database at least 10 years (ADR 0005, `AGENTS.md`); the archives are the copy that survives a loss of the server and of the 35-day window.

### Files and configuration
- `shared/files` (attachments and exports), `shared/.env`, the nginx site and the deployed revision are backed up daily with restic to the 35-day bucket, encrypted by restic, and with the monthly archive above.

### Keys
- Three secrets: pgBackRest's repository passphrase, restic's password and the archive's encryption key. Each lives on the server in a root-only file outside the repository, and the owner holds **two copies of each**: one in their password manager and one printed and kept in a safe place.
- A key lost from the server is restored from the owner's copy. Losing all three copies of a key loses the backups it encrypted, so the deployment PR's report asks the owner to confirm both copies before any real data.
- One set of keys for the whole server now. Keys per company are reconsidered for the commercial product (phase 4).
- The B2 application keys are scoped as above, live only in the server's root-only configuration, and are never committed or printed.

### Restore drills
- **Monthly, automatic:** a job restores the latest off-server backup into a temporary cluster on a spare port, then checks, for every company:
  - the integrity chain from the first entry (ADR 0005), with no break;
  - that every entry balances in both ledgers;
  - the trial balance's totals against the production database at the restore's target time.
  The temporary cluster is then dropped. A failure, or a drill that did not run, sends an alert email to the owner.
- **Quarterly, manual:** a restore to a chosen moment in the last 35 days, and a monthly archive restored with the owner's copy of its key, recorded in `docs/operations/restore-drills.md` (date, target time, duration, result).
- **Daily monitoring:** `pgbackrest check`, the age of the last archived log segment (alert after 15 minutes), the last successful backup in each repository, and free disk space. An alert reaches the owner by email.

### Location (Q7)
- The server's provider and country, and the B2 region of both buckets, are recorded in `docs/deployment.md` by the deployment PR. The data-residency statement for customers stays open in Q7 until phase 4.

### Before real data
Vertex Media's production company is created only after:
1. the deployment PR is merged and deployed;
2. the first full backup has reached B2 and its logs archive continuously;
3. the first monthly drill has passed on the server, and the owner has confirmed both copies of every key.

## Consequences
- Q2 is closed by this decision. The roadmap's "Deployment and backup ADR in force" is done when the three conditions above hold.
- The owner subscribes to Backblaze B2 and creates the two buckets (the archive bucket with Object Lock enabled at creation, which cannot be added later) and the two application keys before the deployment PR's first deploy.
- A second PostgreSQL cluster costs memory on the shared server; the deployment PR checks the server's free memory and swap first.
- pgBackRest and restic are installed from Ubuntu's packages on the server, pinned by the provisioning script.
- Hub's backups are unchanged by this ADR (Hub ADR 0034). Hub may later adopt the same B2 account and scripts in its own change.
- `docs/deployment.md` is written by the deployment PR: the layout, deploy, rollback, the restore commands for a moment, a table and an archive, and the drills.
