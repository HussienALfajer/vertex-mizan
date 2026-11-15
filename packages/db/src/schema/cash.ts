import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies } from './companies.js';
import { entryDrafts, voucherKind } from './drafts.js';
import { journalEntries } from './ledger.js';

// Cash vouchers (S11 rules 9–14): the vouchers the posting function writes with the entries of
// voucher drafts, and the gapless numbers it takes for them per kind and fiscal year. Both are
// written only by `post()` in the posting transaction (ADR 0005 invariant 11); the S11 vouchers
// migration guards them for every role.

/**
 * The last voucher number of a kind in a fiscal year (S11 rule 9), ledger state: made at 1 and
 * moved by one number at a time; every number it gives is taken by a voucher by commit.
 */
export const voucherSequences = pgTable(
  'voucher_sequences',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    kind: voucherKind().notNull(),
    fiscalYear: smallint().notNull(),
    lastNumber: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('voucher_sequences', t.id),
    unique('voucher_sequences_key').on(t.companyId, t.kind, t.fiscalYear),
    check('voucher_sequences_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('voucher_sequences_last_number', sql`${t.lastNumber} >= 1`),
  ],
);

/**
 * A posted voucher (S11 rules 9–14), append-only: its kind and number in its fiscal year, its date,
 * its entry (none only for a count that matched), its draft, its cash account and a transfer's
 * destination, the party as printed, and a count's expected and counted amounts in the box's
 * currency. A cancelled voucher is one whose entry is reversed; the voucher itself never changes.
 */
export const cashVouchers = pgTable(
  'cash_vouchers',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    kind: voucherKind().notNull(),
    fiscalYear: smallint().notNull(),
    number: integer().notNull(),
    voucherDate: date().notNull(),
    entryId: uuid(),
    draftId: uuid().notNull(),
    cashAccountId: uuid().notNull(),
    counterCashAccountId: uuid(),
    partyName: text(),
    countedMinor: bigint({ mode: 'bigint' }),
    expectedMinor: bigint({ mode: 'bigint' }),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('cash_vouchers', t.id),
    unique('cash_vouchers_company_id_id_key').on(t.companyId, t.id),
    unique('cash_vouchers_number_key').on(t.companyId, t.kind, t.fiscalYear, t.number),
    unique('cash_vouchers_entry_key').on(t.companyId, t.entryId),
    unique('cash_vouchers_draft_key').on(t.companyId, t.draftId),
    foreignKey({
      name: 'cash_vouchers_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'cash_vouchers_draft_fk',
      columns: [t.companyId, t.draftId],
      foreignColumns: [entryDrafts.companyId, entryDrafts.id],
    }),
    foreignKey({
      name: 'cash_vouchers_cash_account_fk',
      columns: [t.companyId, t.cashAccountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    foreignKey({
      name: 'cash_vouchers_counter_cash_account_fk',
      columns: [t.companyId, t.counterCashAccountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('cash_vouchers_company_cash_account_idx').on(t.companyId, t.cashAccountId, t.voucherDate),
    index('cash_vouchers_company_counter_cash_account_idx').on(t.companyId, t.counterCashAccountId),
    index('cash_vouchers_company_date_idx').on(t.companyId, t.voucherDate, t.id),
    check('cash_vouchers_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('cash_vouchers_number', sql`${t.number} >= 1`),
    check(
      'cash_vouchers_transfer',
      sql`(${t.counterCashAccountId} is not null) = (${t.kind} = 'transfer')
        and (${t.counterCashAccountId} is null or ${t.counterCashAccountId} <> ${t.cashAccountId})`,
    ),
    check(
      'cash_vouchers_count',
      sql`(${t.countedMinor} is not null) = (${t.kind} = 'count')
        and (${t.expectedMinor} is not null) = (${t.kind} = 'count')
        and (${t.countedMinor} is null or ${t.countedMinor} >= 0)
        and (${t.expectedMinor} is null or ${t.expectedMinor} >= 0)`,
    ),
    // Rule 13: only a count that matches records no entry.
    check(
      'cash_vouchers_entry',
      sql`(${t.entryId} is null) = (${t.kind} = 'count' and ${t.countedMinor} = ${t.expectedMinor})`,
    ),
    check(
      'cash_vouchers_party_name',
      sql`${t.partyName} is null or char_length(${t.partyName}) between 1 and 200`,
    ),
  ],
);
