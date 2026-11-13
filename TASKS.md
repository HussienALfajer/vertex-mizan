# TASKS

## ADR 0021 removal, the API and the worker (branch `refactor/remove-hub-api-worker`)

- [x] apps/api: `/v1`, API clients and keys, inbox, posting rules, revenue, reconciliation; tolerance no longer written; `JobQueue` without event retries
- [x] apps/worker: the event, digest and release jobs and `revenue:run-release`; removed schedules dropped at start
- [x] packages/contracts: `export:hub-schema`, `post:hub-examples`; apps/web: the tolerance section
- [x] The OpenAPI guard and oasdiff (owner, 2026-11-13); `openapi.json` regenerated
- [x] Docs: AGENTS.md commands, CLAUDE.md files, testing, workflow, ROADMAP
- [ ] verify --e2e-all, reviewers, PR with auto-merge

## ADR 0020 deployment (branch `feat/deployment`, on top of `docs/deployment-backup-adr`)

Server facts read 2026-11-13 from `vertex` and `/root/SERVER.md`: Contabo, Ubuntu 24.04, 6 vCPU, 11 GiB RAM (6.3 GiB available), 4 GiB swap (822 MiB used), 129 GB free disk, country FR by IP geolocation (REPORTED, ipinfo.io), timezone Europe/Berlin, PostgreSQL 17.11 cluster `main` on 5432 only, pgBackRest 2.60.0 (PGDG) and restic 0.16.4 not installed. `mizan.vertexmedia.pro` has no DNS record yet.

- [x] `drill:check` in apps/worker with its test (committed)
- [x] deploy/CLAUDE.md, provision.sh, deploy.sh, ecosystem.config.cjs, bin/mizan-common.sh, mizan-deploy, mizan-backup, mizan-archive
- [x] bin/mizan-restore-drill (pgBackRest restore from repo2 with `--archive-mode=off` and a repo2 restore_command into /var/lib/postgresql/mizan-drill on 5434, wait for promotion, `drill:check --restored-port 5434 --restored-at <pg_last_xact_replay_timestamp>` as vertexmizan, stop and remove, stamp `drill`)
- [x] bin/mizan-backup-monitor (every 5 min: pg_stat_archiver failures and age > 15 min while the current WAL file is past the last archived, disk ≥ 85%; daily: `pgbackrest check`, last backup per repo < 30 h, restic latest < 30 h, drill stamp < 35 days, last month's archive stamp after the 3rd), bin/mizan-healthcheck (copy Hub's, port 3300, mizan-api/mizan-worker), bin/mizan-alert (`mizan_alert` from the command line)
- [x] systemd: pm2-vertexmizan.service; mizan-backup (daily 00:30 UTC), mizan-archive (2nd 03:00 UTC), mizan-restore-drill (5th 03:30 UTC), mizan-backup-monitor (5 min), mizan-health (2 min) services and timers, `OnFailure=mizan-alert@%n.service`
- [x] nginx: mizan.vertexmedia.pro (+ .bootstrap), mizan-headers.conf (CSP self), mizan-proxy.conf, mizan-limits.conf (general, sign-in/2FA/reset/invitations tight, /v1 own zone, attachments 11m, /v1/opening/snapshot 6m, /api/docs 404)
- [x] logrotate/mizan.vertexmedia.pro; postgresql/mizan.conf (127.0.0.1:5433, shared_buffers 1GB, archive_command pgbackrest, archive_timeout 60) and postgresql/pg_hba.conf
- [x] docs/deployment.md (layout, location, deploy, rollback, restore to a moment / before a deploy / a table / an archive, B2 key capabilities) and docs/operations/restore-drills.md; ROADMAP, worker CLAUDE.md, AGENTS.md commands (`drill:check`)
- [x] verify --e2e-all, reviewer + accountant-reviewer, PR with auto-merge (the ADR branch merged first, #106)
- [ ] Follow-up (reviewer, not blocking): the migrations still run as `vertexmizan`, which can read the owner URL from the migration's environment during a deploy; a dedicated migration user, or connection logging on `mizan_owner`, closes it
- [x] Owner: DNS A record, B2 buckets/keys/region, SMTP account, alert address, go-ahead to provision (2026-11-13); provisioned, deployed, first full backup in B2, first drill passed
- [x] Owner (2026-11-13): the archive bucket in compliance mode for 3000 days, both copies of the three keys
- [ ] Owner: replace the two B2 application keys and the mailbox password shown during the setup (the server still used them at 14:32 UTC on 2026-11-13): new values in `/etc/mizan/backup.env` and the password in `shared/.env`, provisioning run again, then the old keys deleted in B2
