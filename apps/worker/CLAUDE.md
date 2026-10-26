# apps/worker

NestJS 12 application context (no HTTP server) for background work with pg-boss (ADR 0002): month-end releases, revaluation previews, held-event retries, the reconciliation check, exports and PDFs, each with its spec. Copied from Vertex Food's `apps/worker` and adapted; logging follows Vertex Hub's worker. S01 added the email outbox and the daily clean-up.

## Layout
- `src/main.ts`: loads the config, creates the application context, uses the pino logger, enables shutdown hooks. pg-boss's timers keep the process alive.
- `src/worker.module.ts`: `WorkerModule.forRoot(config, jobs)`: config, nestjs-pino, the app role's database, the email transport, the queue.
- `src/core/config/`: `loadConfig(env)`: `DATABASE_QUEUE_URL` must name `mizan_queue` and `DATABASE_APP_URL` `mizan_app` (a `user` query parameter is refused), `SMTP_URL` (`smtp://` or `smtps://`; locally compose.yaml's Mailpit), `EMAIL_FROM`, `NODE_ENV`, `LOG_LEVEL`.
- `src/core/database/`: `DatabaseModule`, one pool as `mizan_app` (`DATABASE` token), as in `apps/api`.
- `src/core/email/`: `EmailModule` and `EMAIL_TRANSPORT`: the server's SMTP account through nodemailer; the tests put `CapturingTransport` in its place.
- `src/core/queue/`: `QueueModule` (pg-boss as `mizan_queue` in the `pgboss` schema with `createSchema: false`; at start it installs or migrates its tables, then creates (with the job's `queueOptions`), schedules and works every job; graceful stop) and `ScheduledJob`.
- `src/jobs/<module>/<name>.job.ts`: one scheduled job per file, listed in `src/jobs/index.ts`. Pattern to copy: `src/jobs/system/heartbeat.job.ts` (`system.heartbeat`, every minute, logs `Heartbeat`). S01: `src/jobs/email/send.job.ts` (`email.send`, every minute: claims the due outbox rows with a 5-minute lease and `SKIP LOCKED`, sends them, deletes them with their token; a failure keeps its code and waits 2, 4 … 60 minutes; pg-boss keeps its runs one day) with `templates.ts` (the Arabic text from `ar.email`, times in Damascus with Latin digits), and `src/jobs/system/clean-up.job.ts` (`system.clean-up`, daily at 02:00 UTC: expired or idle sessions, expired tokens, old rate-limit rows; expired invitations marked revoked with an audit row per invitation, per company in one transaction).
- `test/worker.ts` (`startWorker()`, `CapturingTransport`), `test/worker.test.ts` (the boot test: the real module on a fresh database installs pg-boss as the queue role, schedules every job once however many workers boot, and works a queued job to `completed`) and `test/jobs.test.ts` (the S01 jobs, run directly). Files run one at a time (`vitest.config.ts`): the boot test's worker works the same database.

## Rules
- Queue names are `<module>.<name>` after the job's file; crons are UTC.
- Every job is idempotent: pg-boss retries, so running a job twice or concurrently leaves the same result.
- Job payloads carry ids, not records; a job loads fresh data in its own transaction.
- pg-boss runs as `mizan_queue` only, which reaches no `public` table. A job that reads company data gets the app role's database (one company, `withCompany`) or the audited `mizan_jobs` role's (cross-company, through its own policies; ADR 0003) with that job: add the module then, as Vertex Food's `jobs-database` module does. Never the owner role (ADR 0008).
- Accounting rules (releases, revaluation, settlement) are decided in `packages/ledger` and posted only through the posting function in `packages/db`; a job only triggers them.
- Explicit `@Inject(Token)` on constructor parameters, as in `apps/api`. Logs through the Nest `Logger`, never `console.log`; an error is logged through `describeForLog`, never its message.

## Tests
Run: `pnpm --filter @vertex-mizan/worker test` (needs the database URLs, `packages/db/CLAUDE.md`) · `pnpm --filter @vertex-mizan/worker typecheck`. `pnpm check:boot` starts the built API and worker together (CI).
