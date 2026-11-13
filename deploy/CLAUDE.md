# deploy

Everything installed on the production server for `mizan.vertexmedia.pro` comes from this folder. Decision: ADR 0020. Runbook: `docs/deployment.md`; drills: `docs/operations/restore-drills.md`. Copied from Vertex Hub's `deploy/` and adapted (Hub ADR 0009).

## Layout
- `provision.sh`: the server's setup, as root, streamed over SSH; idempotent.
- `deploy.sh`: a release, as `vertexmizan` (`build`, `activate`, `rollback`), started by `bin/mizan-deploy` (root), which takes the incremental backup between the build and the migrations.
- `ecosystem.config.cjs`: PM2's `mizan-api` and `mizan-worker`, the environment from `shared/.env`.
- `bin/`: `mizan-deploy`; `mizan-backup` (daily: pgBackRest to both repositories, the 14-day `pg_dump`, restic); `mizan-archive` (monthly, to the Object Lock bucket); `mizan-restore-drill` (monthly); `mizan-backup-monitor` (every 5 minutes, with a daily part); `mizan-healthcheck` (every 2 minutes, heals); `mizan-alert` (one email to the owner); `mizan-common.sh` (constants and helpers they share, installed in `/usr/local/lib/mizan/`).
- `systemd/`, `nginx/`, `logrotate/`, `postgresql/` (the `mizan` cluster's settings and `pg_hba.conf`).

## Rules
- The server is never edited by hand. A change lands here, merges to `main`, and is installed by `provision.sh` or a deploy. The exception is the secrets: `/etc/mizan/backup.env` (B2, SMTP, the alert address) and `/etc/mizan/keys/`, written on the server only and never printed, committed or copied into this folder (the repository is public).
- Server work (`ssh vertex`) on Mizan's production is outward-facing: ask the owner before provisioning, deploying, restoring or deleting there (`AGENTS.md`, "How to work"). Read `/root/SERVER.md` first; never run git as root on the server.
- `provision.sh` stays idempotent: a second run changes nothing.
- Mizan's database is its own PostgreSQL cluster (`17/mizan`, `127.0.0.1:5433`); nothing here touches Hub's cluster (`17/main`, 5432) or its roles.
- Apps listen on `127.0.0.1` only; nginx is the only public listener. One system user (`vertexmizan`), no sudo.
- Scripts use `set -euo pipefail` (the health check and the monitor `set -u`, since they must survive failed probes). Quote every variable. Check with `bash -n <file>` and `shellcheck` when available.
- Secrets never reach a process's arguments, which every user can read: through stdin, a `curl -K -` config or a root-only file.
- A deploy must be able to roll back: migrations are backward compatible (`packages/db/CLAUDE.md`).
- nginx changes are tested with `nginx -t` on the server before reload; a site that fails is taken out of `sites-enabled` at once (`/root/SERVER.md` rule 1).
