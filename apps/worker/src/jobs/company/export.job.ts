import { Inject, Injectable, Logger } from '@nestjs/common';
import { EXPORT_TTL_HOURS, emailDataSchemas } from '@vertex-mizan/contracts';
import {
  companies,
  companyExports,
  type Database,
  describeForLog,
  emailOutbox,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import { FileStore } from '../../core/files/file-store.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';
import { writeArchive } from './archive.js';

/** How long a big company's export may read and write in its transaction (S03: ≤ 5 minutes). */
const EXPORT_TIMEOUT = '10min';

/** The code a failed export keeps: the error's own code when it has a short one, never a message. */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'EXPORT_FAILED';
}

/** Builds an export may start: one that keeps dying (a crash, a kill) is then marked failed. */
export const EXPORT_ATTEMPTS = 3;

/**
 * The full export (S03 rule 21, "Jobs and events"), every minute: the jobs role finds the queued
 * exports across companies; each is claimed (its attempt counted, so an export that kills the
 * worker fails at the third), then built inside its company's context as the app role, from one
 * repeatable-read snapshot under a row lock that a second worker skips. The ZIP streams to its
 * file under the export's key through a temporary name (a retry overwrites its own file), the row
 * becomes `ready` for 24 hours and the owner who asked is emailed, in that transaction. A build
 * that fails deletes whatever file it wrote and marks the export `failed` with its code; the owner
 * can ask again.
 */
@Injectable()
export class CompanyExportJob implements ScheduledJob {
  readonly queue = 'company.export';
  readonly cron = '* * * * *';
  private readonly logger = new Logger(CompanyExportJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async run(): Promise<{ built: number; failed: number }> {
    const queued = await this.jobs
      .select({ companyId: companyExports.companyId, id: companyExports.id })
      .from(companyExports)
      .where(eq(companyExports.state, 'queued'))
      .orderBy(asc(companyExports.id));
    let built = 0;
    let failed = 0;
    for (const { companyId, id } of queued) {
      const claim = await this.claim(companyId, id);
      if (claim === 'busy') continue;
      if (claim === 'failed') {
        // What the builds that died left behind is never kept.
        await this.files
          .removePartials(companyId, id)
          .catch((removal) =>
            this.logger.error(`Export ${id}'s files not deleted: ${describeForLog(removal)}`),
          );
        failed += 1;
        continue;
      }
      try {
        if (await this.build(companyId, id)) built += 1;
      } catch (error) {
        this.logger.error(`Export ${id} failed: ${describeForLog(error)}`);
        // The file a failed build wrote is deleted; failing to delete it never keeps the export
        // from being marked failed.
        await this.files
          .remove(companyId, id)
          .catch((removal) =>
            this.logger.error(`Export ${id}'s file not deleted: ${describeForLog(removal)}`),
          );
        await this.fail(companyId, id, failureCode(error));
        failed += 1;
      }
    }
    if (queued.length > 0) this.logger.log(`Exports: ${built} built, ${failed} failed`);
    return { built, failed };
  }

  /**
   * Counts a build's attempt in its own transaction, so it stays counted if the build kills the
   * worker: `busy` when another worker holds the export, `failed` once the attempts are spent.
   */
  private claim(companyId: string, id: string): Promise<'claimed' | 'busy' | 'failed'> {
    return withCompany(this.db, companyId, async (tx) => {
      const [row] = await tx
        .select({ attempts: companyExports.attempts })
        .from(companyExports)
        .where(and(eq(companyExports.id, id), eq(companyExports.state, 'queued')))
        .for('update', { skipLocked: true });
      if (!row) return 'busy';
      if (row.attempts >= EXPORT_ATTEMPTS) {
        await tx
          .update(companyExports)
          .set({ state: 'failed', error: 'EXPORT_ATTEMPTS' })
          .where(eq(companyExports.id, id));
        return 'failed';
      }
      await tx
        .update(companyExports)
        .set({ attempts: row.attempts + 1 })
        .where(eq(companyExports.id, id));
      return 'claimed';
    });
  }

  private fail(companyId: string, id: string, error: string): Promise<unknown> {
    return withCompany(this.db, companyId, (tx) =>
      tx
        .update(companyExports)
        .set({ state: 'failed', error })
        .where(and(eq(companyExports.id, id), eq(companyExports.state, 'queued'))),
    );
  }

  /** Builds one export; false when another worker holds it or it is no longer queued. */
  private build(companyId: string, id: string): Promise<boolean> {
    return withCompany(
      this.db,
      companyId,
      async (tx) => {
        await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${EXPORT_TIMEOUT}'`)}`);
        await tx.execute(
          sql`set local idle_in_transaction_session_timeout = ${sql.raw(`'${EXPORT_TIMEOUT}'`)}`,
        );
        const [row] = await tx
          .select()
          .from(companyExports)
          .where(and(eq(companyExports.id, id), eq(companyExports.state, 'queued')))
          .for('update', { skipLocked: true });
        if (!row) return false;
        // What an earlier build that died left behind; under the row lock, so never the file a
        // build running beside this one is writing.
        await this.files.removePartials(companyId, id);
        const { size, sha256 } = await writeArchive(
          tx,
          companyId,
          id,
          {
            size: (attachmentId) => this.files.size(companyId, attachmentId),
            open: (attachmentId) => this.files.open(companyId, attachmentId),
          },
          (archive) => this.files.write(companyId, id, archive),
        );
        const [ready] = await tx
          .update(companyExports)
          .set({
            state: 'ready',
            storageKey: `${companyId}/${id}`,
            sizeBytes: size,
            sha256,
            expiresAt: sql`now() + make_interval(hours => ${EXPORT_TTL_HOURS})`,
          })
          .where(eq(companyExports.id, id))
          .returning({ expiresAt: companyExports.expiresAt });
        const [owner] = await tx
          .select({ email: users.email, companyName: companies.name })
          .from(users)
          .innerJoin(companies, eq(companies.id, companyId))
          .where(eq(users.id, row.requestedByUserId));
        if (owner && ready?.expiresAt) {
          const data = emailDataSchemas.export_ready.parse({
            companyName: owner.companyName,
            link: `${this.config.appUrl}/settings/export`,
            expiresAt: ready.expiresAt.toISOString(),
          });
          await tx
            .insert(emailOutbox)
            .values({ kind: 'export_ready', recipient: owner.email.toLowerCase(), data });
        }
        return true;
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
