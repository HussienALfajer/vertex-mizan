# apps/worker

NestJS 12 application context (no HTTP server) for background work with pg-boss (ADR 0002): month-end releases, revaluation previews, held-event retries, the reconciliation check, exports and PDFs, each with its spec. Copied from Vertex Food's `apps/worker` and adapted; logging follows Vertex Hub's worker. Phase 0 holds the queue and the heartbeat only.

## Layout
- `src/main.ts`: loads the config, creates the application context, uses the pino logger, enables shutdown hooks. pg-boss's timers keep the process alive.
- `src/worker.module.ts`: `WorkerModule.forRoot(config, jobs)`: config, nestjs-pino, the queue.
- `src/core/config/`: `loadConfig(env)`: `DATABASE_QUEUE_URL` must name `mizan_queue` (a `user` query parameter is refused), `NODE_ENV`, `LOG_LEVEL`.
- `src/core/queue/`: `QueueModule` (pg-boss as `mizan_queue` in the `pgboss` schema with `createSchema: false`; at start it installs or migrates its tables, then creates, schedules and works every job; graceful stop) and `ScheduledJob`.
- `src/jobs/<module>/<name>.job.ts`: one scheduled job per file, listed in `src/jobs/index.ts`. Pattern to copy: `src/jobs/system/heartbeat.job.ts` (`system.heartbeat`, every minute, logs `Heartbeat`).
- `test/worker.test.ts`: the boot test: the real module on a fresh database installs pg-boss as the queue role, schedules the heartbeat once however many workers boot, and works a queued job to `completed`.

## Rules
- Queue names are `<module>.<name>` after the job's file; crons are UTC.
- Every job is idempotent: pg-boss retries, so running a job twice or concurrently leaves the same result.
- Job payloads carry ids, not records; a job loads fresh data in its own transaction.
- pg-boss runs as `mizan_queue` only, which reaches no `public` table. A job that reads company data gets the app role's database (one company, `withCompany`) or the audited `mizan_jobs` role's (cross-company, through its own policies; ADR 0003) with that job: add the module then, as Vertex Food's `jobs-database` module does. Never the owner role (ADR 0008).
- Accounting rules (releases, revaluation, settlement) are decided in `packages/ledger` and posted only through the posting function in `packages/db`; a job only triggers them.
- Explicit `@Inject(Token)` on constructor parameters, as in `apps/api`. Logs through the Nest `Logger`, never `console.log`; an error is logged through `describeForLog`, never its message.

## Tests
Run: `pnpm --filter @vertex-mizan/worker test` (needs the database URLs, `packages/db/CLAUDE.md`) · `pnpm --filter @vertex-mizan/worker typecheck`. `pnpm check:boot` starts the built API and worker together (CI).
