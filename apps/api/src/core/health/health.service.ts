import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async check(): Promise<HealthResponse> {
    const database = await this.ping();
    return {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }

  /** A round trip to the database; any failure (refused, timed out, lost) counts as down. */
  private async ping(): Promise<'up' | 'down'> {
    try {
      await this.db.execute(sql`select 1`);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
