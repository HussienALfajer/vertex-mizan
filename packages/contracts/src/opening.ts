import { z } from 'zod';
import { currencyCodeSchema } from './money.js';
import { minorUnitsSchema } from './wire.js';

// The opening balances (S10, ADR 0019 as amended by ADR 0021): the accountant's draft (rules
// 14–16) and the names of its states and checks (rule 21). Hub's snapshot left with Hub (ADR
// 0021). The internal `/api` sends amounts as `MinorUnits`.

// The states live in `opening-states.ts`, which `companies.ts` reads without the draft's schemas.
export * from './opening-states.js';

/** The checks that must all pass to post (S10 rule 21), in the order a refusal lists them. */
export const OPENING_CHECKS = ['rates', 'mappings', 'lines'] as const;

export const openingCheckSchema = z.enum(OPENING_CHECKS).meta({ id: 'OpeningCheck' });

export type OpeningCheck = z.infer<typeof openingCheckSchema>;

/** The most lines the accountant saves in one draft. */
export const OPENING_LINE_LIMIT = 1000;

const memoSchema = z.string().trim().min(1).max(300);

/**
 * A line of the accountant (S10 rules 14, 17): the account, its dimension values, the currency and
 * the amount, debit positive. `book` and `parallel` only on a stated line (non-monetary or
 * equity), each omitted in its ledger's own currency, where the amount is itself. An item on a
 * control account names its reference and its optional due date (S04 rule 6).
 */
export const openingLineInputSchema = z
  .object({
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()).max(20).default([]),
    currency: currencyCodeSchema,
    amount: minorUnitsSchema.refine((text) => text !== '0', 'Not zero'),
    book: minorUnitsSchema.nullable().default(null),
    parallel: minorUnitsSchema.nullable().default(null),
    itemReference: z.string().trim().min(1).max(100).nullable().default(null),
    itemDueOn: z.iso.date().nullable().default(null),
    memo: memoSchema.nullable().default(null),
  })
  .refine((line) => line.itemDueOn === null || line.itemReference !== null, {
    path: ['itemDueOn'],
    message: 'A due date only on an item',
  })
  .meta({ id: 'OpeningLineInput' });

export type OpeningLineInput = z.infer<typeof openingLineInputSchema>;

/**
 * `PUT /api/opening`: the accountant's lines, replacing the draft's as one write against its
 * `version` (0 before the first save; S10 rule 16).
 */
export const saveOpeningSchema = z
  .object({
    version: z.int().min(0),
    lines: z.array(openingLineInputSchema).max(OPENING_LINE_LIMIT),
  })
  .meta({ id: 'SaveOpening' });

export type SaveOpening = z.infer<typeof saveOpeningSchema>;

/** `POST /api/opening/post`: the preview's fingerprint (S10 rule 23). */
export const postOpeningSchema = z
  .object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) })
  .meta({ id: 'PostOpening' });

export type PostOpening = z.infer<typeof postOpeningSchema>;
