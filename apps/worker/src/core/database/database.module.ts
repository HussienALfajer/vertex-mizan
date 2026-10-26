import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@vertex-mizan/db';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/** Injection token for the Drizzle database of the app role (ADR 0008). */
export const DATABASE = Symbol('DATABASE');

/**
 * One pool for the worker's jobs, as `mizan_app`, as in `apps/api`: the email outbox and the
 * clean-up of the ephemeral tables (S01). A company's rows only through `withCompany`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.appDatabaseUrl),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
