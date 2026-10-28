import {
  bigint,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  updatedAt,
} from '../../src/schema/columns.js';

// Test-only tables, built with the shared column helpers as a real schema file would be, so the
// conventions and the guards are proven before the first real table (S01) and the ledger tables
// (S03). The global setup creates them in the run's database only, from this file through
// drizzle-kit, then applies `guards.sql`; no migration contains them.

/** A company business table, parent of a composite key. */
export const fixtureDocuments = pgTable(
  'fixture_documents',
  {
    id: id(),
    companyId: companyId(),
    title: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    currency: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('fixture_documents', t.id),
    unique('fixture_documents_company_id_id_key').on(t.companyId, t.id),
  ],
);

/**
 * A company append-only table with a composite key to a business table. An entry states how many
 * lines it has, so a line added by a later transaction makes it fail its deferred check.
 */
export const fixtureEntries = pgTable(
  'fixture_entries',
  {
    id: id(),
    companyId: companyId(),
    documentId: uuid().notNull(),
    lineCount: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('fixture_entries', t.id),
    unique('fixture_entries_company_id_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'fixture_entries_document_fk',
      columns: [t.companyId, t.documentId],
      foreignColumns: [fixtureDocuments.companyId, fixtureDocuments.id],
    }),
    index('fixture_entries_company_document_idx').on(t.companyId, t.documentId),
  ],
);

/** A company append-only table whose entries must balance at commit (a deferred trigger). */
export const fixtureLines = pgTable(
  'fixture_lines',
  {
    id: id(),
    companyId: companyId(),
    entryId: uuid().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('fixture_lines', t.id),
    foreignKey({
      name: 'fixture_lines_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [fixtureEntries.companyId, fixtureEntries.id],
    }),
    index('fixture_lines_company_entry_idx').on(t.companyId, t.entryId),
  ],
);

/**
 * A company ledger-state table: a counter the app role adds and moves, never deletes, through a
 * guard that lets it move by one only (ADR 0012).
 */
export const fixtureCounters = pgTable(
  'fixture_counters',
  {
    id: id(),
    companyId: companyId(),
    lastNumber: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('fixture_counters', t.id),
    unique('fixture_counters_company_id_key').on(t.companyId),
  ],
);

/** A platform business table: no company scope. */
export const fixtureSettings = pgTable(
  'fixture_settings',
  {
    id: id(),
    name: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [idIsUuidV7('fixture_settings', t.id)],
);

/** A platform ephemeral table: rows are deleted once used or expired, and nothing references it. */
export const fixtureTokens = pgTable(
  'fixture_tokens',
  {
    id: id(),
    value: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [idIsUuidV7('fixture_tokens', t.id)],
);
