# TASKS

No task in progress (S12 done: `docs/ROADMAP.md`).

## Carried over

- [ ] Follow-up (reviewer, not blocking, ADR 0020 deployment): the migrations still run as `vertexmizan`, which can read the owner URL from the migration's environment during a deploy; a dedicated migration user, or connection logging on `mizan_owner`, closes it
- [ ] Owner: replace the two B2 application keys and the mailbox password shown during the setup (the server still used them at 14:32 UTC on 2026-11-13): new values in `/etc/mizan/backup.env` and the password in `shared/.env`, provisioning run again, then the old keys deleted in B2
