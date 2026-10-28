import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { companies } from './companies.js';
import { journalEntries } from './ledger.js';

// The trust module (S03 rules 19–21, ADR 0005, ADR 0008): the daily anchors of each company's
// chain, written by the worker's jobs role, and the owner's full exports, a queue the API fills and
// the worker works.

const HASH = sql.raw(`'^[0-9a-f]{64}$'`);

/** The states of a full export; `EXPORT_STATES` in `@vertex-mizan/contracts` (a test keeps them equal). */
export const COMPANY_EXPORT_STATES = ['queued', 'ready', 'failed', 'expired'] as const;

/**
 * A company's chain head as at the end of a day in Damascus (S03 rule 20): the number of entries
 * posted by then, the last of them and its hash, emailed to every owner. Append-only; one per
 * company and day, so a second run of the job writes nothing. A company with no entries by then
 * gets none. `email_outbox_ids` are the emails that carried it (sent and deleted later).
 */
export const chainAnchors = pgTable(
  'chain_anchors',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    anchoredOn: date().notNull(),
    entryCount: bigint({ mode: 'bigint' }).notNull(),
    headEntryId: uuid().notNull(),
    headHash: text().notNull(),
    emailOutboxIds: uuid().array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('chain_anchors', t.id),
    unique('chain_anchors_day_key').on(t.companyId, t.anchoredOn),
    foreignKey({
      name: 'chain_anchors_head_entry_fk',
      columns: [t.companyId, t.headEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    index('chain_anchors_company_head_entry_idx').on(t.companyId, t.headEntryId),
    check('chain_anchors_entry_count', sql`${t.entryCount} >= 1`),
    check('chain_anchors_head_hash', sql`${t.headHash} ~ ${HASH}`),
  ],
);

/**
 * The owner's full export of a company's data (S03 rule 21): `queued` when requested (one at a
 * time), then `ready` with its file under `MIZAN_FILES_DIR` (`<company_id>/<id>`), its size and
 * SHA-256 and 24 hours to download, or `failed` with an error code; a ready export past
 * `expires_at` has its file deleted and becomes `expired`.
 */
export const companyExports = pgTable(
  'company_exports',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** The owner who asked, as drafts keep their people: no key to the platform's users. */
    requestedByUserId: uuid().notNull(),
    state: text().notNull().default('queued'),
    storageKey: text(),
    sizeBytes: bigint({ mode: 'number' }),
    sha256: text(),
    /** The code of the failure (an error code or a Node code), never its message. */
    error: text(),
    /** How many builds started: an export that keeps dying (a crash, a kill) fails at three. */
    attempts: integer().notNull().default(0),
    expiresAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('company_exports', t.id),
    unique('company_exports_company_id_id_key').on(t.companyId, t.id),
    uniqueIndex('company_exports_one_queued_key').on(t.companyId).where(sql`${t.state} = 'queued'`),
    index('company_exports_company_created_idx').on(t.companyId, t.createdAt),
    check(
      'company_exports_state',
      sql`${t.state} in (${sql.raw(COMPANY_EXPORT_STATES.map((s) => `'${s}'`).join(', '))})`,
    ),
    check(
      'company_exports_ready_fields',
      sql`(${t.state} in ('ready', 'expired')) = (${t.storageKey} is not null)
        and (${t.storageKey} is null) = (${t.sizeBytes} is null)
        and (${t.storageKey} is null) = (${t.sha256} is null)
        and (${t.storageKey} is null) = (${t.expiresAt} is null)
        and (${t.state} = 'failed') = (${t.error} is not null)`,
    ),
    check(
      'company_exports_storage_key',
      sql`${t.storageKey} is null or ${t.storageKey} = ${t.companyId}::text || '/' || ${t.id}::text`,
    ),
    check('company_exports_size', sql`${t.sizeBytes} is null or ${t.sizeBytes} > 0`),
    check('company_exports_attempts', sql`${t.attempts} >= 0`),
    check('company_exports_sha256', sql`${t.sha256} is null or ${t.sha256} ~ ${HASH}`),
    check(
      'company_exports_error_length',
      sql`${t.error} is null or char_length(${t.error}) between 1 and 100`,
    ),
  ],
);
