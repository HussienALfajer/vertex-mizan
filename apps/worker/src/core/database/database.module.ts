import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@vertex-mizan/db';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/** Injection token for the Drizzle database of the app role (ADR 0008). */
export const DATABASE = Symbol('DATABASE');

/**
 * Injection token for the jobs role's database (ADR 0003): across companies, only through the
 * policies and grants its migration gives it (`packages/db`'s convention test pins them).
 */
export const JOBS_DATABASE = Symbol('JOBS_DATABASE');

/**
 * The worker's pools: as `mizan_app`, as in `apps/api` (the email outbox, the clean-up of the
 * ephemeral tables, a company's rows only through `withCompany`), and as `mizan_jobs` for the jobs
 * that reach across companies (S03: the daily anchor, finding the exports).
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.appDatabaseUrl),
    },
    {
      provide: JOBS_DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.jobsDatabaseUrl),
    },
  ],
  exports: [DATABASE, JOBS_DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.$client.end(), this.jobs.$client.end()]);
  }
}
