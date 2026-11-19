import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { entryDrafts } from './drafts.js';
import { journalEntries } from './ledger.js';
import { materials } from './projects.js';

// Project movements (S13, ADR 0024): one person's simple movements on a project, each posted in one
// transaction through an existing path (a voucher, a purchase invoice or a manual entry), with the
// gapless numbers they take per fiscal year, their cancellations, a project's dates and state, and
// the company's display name and logo. The S13 migration guards them for every role.

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** The kinds of movement (S13 "Data"); `PROJECT_MOVEMENT_KINDS` in contracts equals it (a test). */
export const PROJECT_MOVEMENT_KINDS = [
  'received',
  'expense',
  'wages',
  'owed_by_us',
  'owed_to_us',
  'debt_paid',
  'debt_collected',
  'deposit',
] as const;

export const movementKind = pgEnum('movement_kind', PROJECT_MOVEMENT_KINDS);

export const PROJECT_STATES = ['active', 'finished'] as const;

export const projectState = pgEnum('project_state', PROJECT_STATES);

/**
 * The last movement number of a fiscal year (S13 rule 1), ledger state: made at 1 and moved by one
 * number at a time; every number it gives is taken by a movement by commit.
 */
export const projectMovementSequences = pgTable(
  'project_movement_sequences',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    fiscalYear: smallint().notNull(),
    lastNumber: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('project_movement_sequences', t.id),
    unique('project_movement_sequences_key').on(t.companyId, t.fiscalYear),
    check('project_movement_sequences_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('project_movement_sequences_last_number', sql`${t.lastNumber} >= 1`),
  ],
);

/**
 * A recorded movement (S13 "Data"), append-only: its kind and number in its fiscal year, its date,
 * its project and party, its currency and amount as typed, its material, the entry it posted from
 * its draft, and the request that made it. A cancelled movement is one with a cancellation row; the
 * movement itself never changes.
 */
export const projectMovements = pgTable(
  'project_movements',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    kind: movementKind().notNull(),
    fiscalYear: smallint().notNull(),
    number: integer().notNull(),
    movementDate: date().notNull(),
    contractValueId: uuid(),
    counterpartyValueId: uuid(),
    currency: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    description: text().notNull(),
    materialId: uuid(),
    entryId: uuid().notNull(),
    draftId: uuid().notNull(),
    requestKey: text().notNull(),
    requestHash: text().notNull(),
    createdByUserId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('project_movements', t.id),
    unique('project_movements_company_id_id_key').on(t.companyId, t.id),
    unique('project_movements_number_key').on(t.companyId, t.fiscalYear, t.number),
    unique('project_movements_entry_key').on(t.companyId, t.entryId),
    unique('project_movements_draft_key').on(t.companyId, t.draftId),
    unique('project_movements_request_key').on(t.companyId, t.requestKey),
    foreignKey({
      name: 'project_movements_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'project_movements_draft_fk',
      columns: [t.companyId, t.draftId],
      foreignColumns: [entryDrafts.companyId, entryDrafts.id],
    }),
    foreignKey({
      name: 'project_movements_contract_value_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'project_movements_counterparty_value_fk',
      columns: [t.companyId, t.counterpartyValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'project_movements_material_fk',
      columns: [t.companyId, t.materialId],
      foreignColumns: [materials.companyId, materials.id],
    }),
    index('project_movements_company_contract_idx').on(
      t.companyId,
      t.contractValueId,
      t.movementDate,
    ),
    index('project_movements_company_counterparty_idx').on(t.companyId, t.counterpartyValueId),
    index('project_movements_company_material_idx').on(t.companyId, t.materialId),
    index('project_movements_company_date_idx').on(t.companyId, t.movementDate, t.id),
    check('project_movements_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('project_movements_number', sql`${t.number} >= 1`),
    check('project_movements_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check('project_movements_amount', sql`${t.amountMinor} > 0`),
    check('project_movements_description', sql`char_length(${t.description}) between 1 and 500`),
    check(
      'project_movements_request',
      sql`char_length(${t.requestKey}) between 1 and 100 and ${t.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    // Which fields a kind takes (S13 "Data"): a project on every kind but a deposit; a party on the
    // client's and the supplier's kinds only; a material on an expense or a debt owed by us only.
    check(
      'project_movements_kind_fields',
      sql`((${t.contractValueId} is null) = (${t.kind} = 'deposit'))
        and ((${t.counterpartyValueId} is null)
          = (${t.kind} in ('expense', 'wages', 'deposit')))
        and (${t.materialId} is null or ${t.kind} in ('expense', 'owed_by_us'))`,
    ),
  ],
);

/**
 * A movement's cancellation (S13 rule 8), append-only: the reversal entry that cancelled it, the
 * reason, and who cancelled it.
 */
export const projectMovementCancellations = pgTable(
  'project_movement_cancellations',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    movementId: uuid().notNull(),
    reversalEntryId: uuid().notNull(),
    reason: text().notNull(),
    createdByUserId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('project_movement_cancellations', t.id),
    unique('project_movement_cancellations_movement_key').on(t.companyId, t.movementId),
    unique('project_movement_cancellations_reversal_key').on(t.companyId, t.reversalEntryId),
    foreignKey({
      name: 'project_movement_cancellations_movement_fk',
      columns: [t.companyId, t.movementId],
      foreignColumns: [projectMovements.companyId, projectMovements.id],
    }),
    foreignKey({
      name: 'project_movement_cancellations_reversal_fk',
      columns: [t.companyId, t.reversalEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    check('project_movement_cancellations_reason', sql`char_length(${t.reason}) between 1 and 500`),
  ],
);

/**
 * A project's start date and state (S13 "Data"): management data with no accounting effect. A
 * finished project takes no new movement (rule 9).
 */
export const projectDetails = pgTable(
  'project_details',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    contractValueId: uuid().notNull(),
    startDate: date().notNull(),
    state: projectState().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('project_details', t.id),
    unique('project_details_company_id_id_key').on(t.companyId, t.id),
    unique('project_details_contract_key').on(t.companyId, t.contractValueId),
    foreignKey({
      name: 'project_details_contract_value_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
  ],
);

/**
 * The company's display name and logo (S13 "Data", ADR 0024 §7): one row per company, the logo a
 * stored file of at most 1 MB, PNG or JPEG.
 */
export const companyBranding = pgTable(
  'company_branding',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    displayName: text().notNull(),
    logoStorageKey: text(),
    logoContentType: text(),
    logoSha256: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('company_branding', t.id),
    unique('company_branding_company_key').on(t.companyId),
    check('company_branding_display_name', sql`char_length(${t.displayName}) between 1 and 200`),
    check(
      'company_branding_logo',
      sql`(${t.logoStorageKey} is null) = (${t.logoContentType} is null)
        and (${t.logoStorageKey} is null) = (${t.logoSha256} is null)
        and (${t.logoContentType} is null or ${t.logoContentType} in ('image/png', 'image/jpeg'))
        and (${t.logoSha256} is null or ${t.logoSha256} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);
