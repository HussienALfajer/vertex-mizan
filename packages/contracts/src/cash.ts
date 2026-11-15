import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { cashKindSchema } from './chart.js';
import { entrySchema } from './entries.js';
import { currencyCodeSchema, ledgerSchema } from './money.js';
import { voucherKindSchema, voucherNumberSchema } from './vouchers.js';
import { minorUnitsSchema, moneyAmountSchema, personRefSchema } from './wire.js';

/**
 * The cash accounts and their vouchers (S11 rules 9–17): the cash position at a date, a cash
 * account's statement, the vouchers' register and a voucher with its entry. The header a voucher
 * draft carries is `vouchers.ts`'s.
 */

/** A cash account as the cash screens name it: its code, names, kind and currency. */
export const cashAccountRefSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    cashKind: cashKindSchema,
    currency: currencyCodeSchema,
  })
  .meta({ id: 'CashAccountRef' });

export type CashAccountRef = z.infer<typeof cashAccountRefSchema>;

/** `GET /api/cash/accounts`: the position at the end of `asOf` (today when left out). */
export const cashPositionQuerySchema = z
  .object({ asOf: z.iso.date().optional() })
  .meta({ id: 'CashPositionQuery' });

export type CashPositionQuery = z.infer<typeof cashPositionQuerySchema>;

/** A cash account's balance in its currency and its carrying amounts in each ledger (rule 16). */
export const cashPositionAccountSchema = z
  .object({
    ...cashAccountRefSchema.shape,
    balance: moneyAmountSchema,
    book: moneyAmountSchema,
    /** Null when the company keeps no parallel ledger. */
    parallel: moneyAmountSchema.nullable(),
  })
  .meta({ id: 'CashPositionAccount' });

export type CashPositionAccount = z.infer<typeof cashPositionAccountSchema>;

/** One currency's cash accounts with their total, in the currency and in each ledger. */
export const cashPositionGroupSchema = z
  .object({
    currency: currencyCodeSchema,
    accounts: z.array(cashPositionAccountSchema),
    total: moneyAmountSchema,
    book: moneyAmountSchema,
    parallel: moneyAmountSchema.nullable(),
  })
  .meta({ id: 'CashPositionGroup' });

export type CashPositionGroup = z.infer<typeof cashPositionGroupSchema>;

/**
 * The cash position (rule 16): every unarchived cash account at `asOf`, grouped by currency in code
 * order, with the totals of each ledger over every group.
 */
export const cashPositionSchema = z
  .object({
    asOf: z.iso.date(),
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    groups: z.array(cashPositionGroupSchema),
    book: moneyAmountSchema,
    parallel: moneyAmountSchema.nullable(),
  })
  .meta({ id: 'CashPosition' });

export type CashPosition = z.infer<typeof cashPositionSchema>;

/** `GET /api/cash/accounts/:id/statement`: a range of dates and the ledger columns to show. */
export const cashStatementQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    ledgers: z
      .string()
      .optional()
      .transform((text, context) => {
        const names = text ? text.split(',').filter((name) => name !== '') : [];
        for (const name of names) {
          if (!ledgerSchema.safeParse(name).success) {
            context.addIssue({ code: 'custom', message: 'Expected book or parallel' });
            return z.NEVER;
          }
        }
        return [...new Set(names)] as z.infer<typeof ledgerSchema>[];
      }),
  })
  .refine((query) => query.from <= query.to, {
    message: 'The range ends before it starts',
    path: ['to'],
  })
  .meta({ id: 'CashStatementQuery' });

export type CashStatementQuery = z.infer<typeof cashStatementQuerySchema>;

/** The amounts of a statement balance: in the account's currency, and each ledger asked. */
export const cashBalancesSchema = z
  .object({
    amount: moneyAmountSchema,
    book: moneyAmountSchema.nullable(),
    parallel: moneyAmountSchema.nullable(),
  })
  .meta({ id: 'CashBalances' });

export type CashBalances = z.infer<typeof cashBalancesSchema>;

/**
 * A row of a cash account's statement (rule 17): a line on the account in date then entry order,
 * with its voucher, counter account (`null` with several: "متعدد"), counterparty and contract, in
 * and out and the running balance; or a count, with its expected and counted amounts.
 */
export const cashStatementRowSchema = z
  .object({
    kind: z.enum(['line', 'count']),
    date: z.iso.date(),
    entry: z
      .object({ id: z.uuid(), fiscalYear: z.int(), number: z.int(), lineNo: z.int().min(1) })
      .nullable(),
    voucher: voucherNumberSchema.extend({ id: z.uuid() }).nullable(),
    description: z.string(),
    counterAccount: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    /** The counter lines span several accounts. */
    severalCounterAccounts: z.boolean(),
    counterparty: z
      .object({ id: z.uuid(), code: z.string().nullable(), name: z.string() })
      .nullable(),
    contract: z.object({ id: z.uuid(), code: z.string().nullable(), name: z.string() }).nullable(),
    in: minorUnitsSchema,
    out: minorUnitsSchema,
    balance: minorUnitsSchema,
    book: minorUnitsSchema.nullable(),
    parallel: minorUnitsSchema.nullable(),
    expectedMinor: minorUnitsSchema.nullable(),
    countedMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'CashStatementRow' });

export type CashStatementRow = z.infer<typeof cashStatementRowSchema>;

/** A cash account's statement for a range (rule 17): opening plus in less out is the closing. */
export const cashStatementSchema = z
  .object({
    account: cashAccountRefSchema,
    from: z.iso.date(),
    to: z.iso.date(),
    ledgers: z.array(ledgerSchema),
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    opening: cashBalancesSchema,
    rows: z.array(cashStatementRowSchema),
    totalIn: minorUnitsSchema,
    totalOut: minorUnitsSchema,
    closing: cashBalancesSchema,
  })
  .meta({ id: 'CashStatement' });

export type CashStatement = z.infer<typeof cashStatementSchema>;

/** A voucher's state: posted, or cancelled by the reversal of its entry (rule 14). */
export const VOUCHER_STATES = ['posted', 'cancelled'] as const;

export const voucherStateSchema = z.enum(VOUCHER_STATES).meta({ id: 'VoucherState' });

export type VoucherState = z.infer<typeof voucherStateSchema>;

/** `GET /api/vouchers`: by voucher date, newest first, pages of 100. */
export const voucherQuerySchema = z
  .object({
    kind: voucherKindSchema.optional(),
    cashAccount: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    state: voucherStateSchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'VoucherQuery' });

export type VoucherQuery = z.infer<typeof voucherQuerySchema>;

/** A row of the vouchers' register. */
export const voucherSummarySchema = z
  .object({
    id: z.uuid(),
    ...voucherNumberSchema.shape,
    date: z.iso.date(),
    state: voucherStateSchema,
    cashAccount: cashAccountRefSchema,
    counterCashAccount: cashAccountRefSchema.nullable(),
    /** The cash account's movement: in for a receipt or an overage, out otherwise. */
    amount: moneyAmountSchema,
    partyName: z.string().nullable(),
    description: z.string(),
    entry: z.object({ id: z.uuid(), fiscalYear: z.int(), number: z.int() }).nullable(),
    reversal: z.object({ id: z.uuid(), fiscalYear: z.int(), number: z.int() }).nullable(),
    expectedMinor: minorUnitsSchema.nullable(),
    countedMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'VoucherSummary' });

export type VoucherSummary = z.infer<typeof voucherSummarySchema>;

export const voucherPageSchema = z
  .object({ vouchers: z.array(voucherSummarySchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'VoucherPage' });

export type VoucherPage = z.infer<typeof voucherPageSchema>;

/** `GET /api/vouchers/:id`: the voucher with its entry, preparer and approver. */
export const voucherSchema = z
  .object({
    ...voucherSummarySchema.shape,
    draftId: z.uuid(),
    preparedBy: personRefSchema.nullable(),
    approvedBy: personRefSchema.nullable(),
    entryDetail: entrySchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Voucher' });

export type Voucher = z.infer<typeof voucherSchema>;
