# Restore drills

A backup counts only once it has been restored (ADR 0020, "Restore drills"). The commands are in `docs/deployment.md`, "Restore".

## Monthly, automatic

`mizan-restore-drill.timer` runs `deploy/bin/mizan-restore-drill` on the 5th at 03:30 UTC, as root:

1. The latest backup of the **off-server** repository (repo2, B2) is restored with pgBackRest into a temporary cluster in `/var/lib/postgresql/mizan-drill` on `127.0.0.1:5434`, with archiving off and the write-ahead log fetched from repo2 only, to the end of the archive. Nothing comes from the local repository, so the drill proves what survives a loss of the server.
2. The cluster replays the log and promotes; the drill reads the last replayed commit's time.
3. `drill:check` (`apps/worker/src/commands/restore-drill-check.ts`), run from the deployed release as `vertexmizan` with production's environment, reads both clusters as the app and jobs roles, company by company:
   - the restored books through the same checks as `POST /api/integrity/check` (ADR 0005): the chain from the first entry, its numbering and head, every entry balanced in the book and parallel ledgers, the period balances the reports read against the lines, each control account against its items and each item's balance row against its movements, each contract's schedules against its contract liability lines, and every stored anchor against the chain;
   - the restored head is production's entry with the same sequence and hash;
   - every entry production posted more than 5 minutes before the restored moment is in the restore;
   - the trial balance (each account and currency, in transaction, book and parallel amounts) of the restored entries equals production's over the same prefix of the chain;
   - the restored moment is under 26 hours old, so a stalled archive fails the drill.
4. The temporary cluster is stopped and removed, pass or fail. A pass writes the `drill` stamp and a journal line with the restored moment and the duration.

A failure exits non-zero and `mizan-alert@mizan-restore-drill.service` emails the owner the unit's journal. A drill that did not run is caught by the daily monitor: no passed drill for 35 days is an alert.

Run one by hand, for example after provisioning (ADR 0020, "Before real data", condition 3):

```bash
ssh vertex systemctl start mizan-restore-drill.service
ssh vertex journalctl -u mizan-restore-drill -n 100
```

Each company prints `ok company <id>: <n> entries, head <sequence>` or `FAILED` with its problems, and the last line is `restore drill: ok` or `restore drill: FAILED`. A failure is investigated before anything else: the off-server copy may not hold what production holds. Never "fix" it by changing production's data.

## Quarterly, manual

In January, April, July and October, with the owner:

1. **A moment of the last 35 days.** The owner picks a moment (not the latest). Restore it from repo2 into a temporary cluster, as the automatic drill does but with `--type=time --target="<moment>" --target-action=promote` instead of `--type=default`, then run `drill:check` with `--restored-at "<moment>" --max-age-hours 900` (the moment is old on purpose). Remove the temporary cluster.
2. **A monthly archive with the owner's copy of its key.** Download an archive at least a month old, decrypt it with the owner's copy of the archive key (not the server's), check the manifest's checksums and `pg_restore --list` the dump, and restore it into a scratch database to read one known figure of a month closed before the archive was taken (the archive of month M is taken on the 2nd of M+1, before M is usually closed, so M's closed figures are in the archive of M+1). This proves the owner's copy of the key works.
3. Record both below.

## Record

| Date | Kind | Target time (UTC) | Source | Duration | Result | By |
|---|---|---|---|---|---|---|
