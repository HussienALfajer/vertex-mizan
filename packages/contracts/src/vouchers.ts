import { z } from 'zod';
import { currencyCodeSchema, rateValueSchema } from './money.js';
import { minorUnitsSchema } from './wire.js';

/**
 * A cash voucher's header (S11 rules 9–13), which a draft carries beside its lines: the voucher's
 * kind, its cash account, a transfer's destination, the party as printed and a count's counted
 * amount. `entries.ts` adds it to the draft schemas; `cash.ts` holds the vouchers' reads.
 */

/**
 * The kinds of a voucher (S11 rules 10–13), stored in the `voucher_kind` enum: a value is never
 * renamed, a new one appended. Each kind has its own numbers per fiscal year.
 */
export const VOUCHER_KINDS = ['receipt', 'payment', 'transfer', 'count'] as const;

export const voucherKindSchema = z.enum(VOUCHER_KINDS).meta({ id: 'VoucherKind' });

export type VoucherKind = z.infer<typeof voucherKindSchema>;

/** Who paid or was paid, as the voucher prints it (`استلمنا من`, `صرفنا إلى`): 1–200 characters. */
export const partyNameSchema = z.string().trim().min(1).max(200);

/**
 * A draft's voucher header as typed (S11 "API": `voucher: { kind, cashAccountId,
 * counterCashAccountId?, partyName?, countedMinor? }`). The destination is a transfer's only, the
 * counted amount a count's only, never below zero; the rest of the rules (a cash account, two
 * different accounts, the lines' shape) are checked at submission and posting.
 */
export const voucherHeaderInputSchema = z
  .object({
    kind: voucherKindSchema,
    cashAccountId: z.uuid(),
    counterCashAccountId: z.uuid().nullable().default(null),
    partyName: partyNameSchema.nullable().default(null),
    countedMinor: minorUnitsSchema
      .refine((text) => !text.startsWith('-'), 'A box is never below zero')
      .nullable()
      .default(null),
  })
  .superRefine((header, context) => {
    if ((header.counterCashAccountId !== null) !== (header.kind === 'transfer')) {
      context.addIssue({
        code: 'custom',
        message: 'A transfer, and only a transfer, names its destination',
        path: ['counterCashAccountId'],
      });
    }
    if (header.kind !== 'count' && header.countedMinor !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Only a count has a counted amount',
        path: ['countedMinor'],
      });
    }
  })
  .meta({ id: 'VoucherHeaderInput' });

export type VoucherHeaderInput = z.infer<typeof voucherHeaderInputSchema>;

/** A draft's voucher header as stored and returned. */
export const voucherHeaderSchema = z
  .object({
    kind: voucherKindSchema,
    cashAccountId: z.uuid(),
    counterCashAccountId: z.uuid().nullable(),
    partyName: z.string().nullable(),
    countedMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'VoucherHeader' });

export type VoucherHeader = z.infer<typeof voucherHeaderSchema>;

/**
 * What the preview of a voucher draft adds (S11 "API"): its kind; for a transfer between two
 * currencies, the dealt rate derived from its amounts (rule 12), in the company's orientation of the
 * pair, or null; for a count, the box's expected balance at the end of the count's date, which the
 * post carries back (rule 13), and the difference, counted minus expected.
 */
export const voucherPreviewSchema = z
  .object({
    kind: voucherKindSchema,
    derivedRate: z
      .object({ base: currencyCodeSchema, quote: currencyCodeSchema, rate: rateValueSchema })
      .nullable(),
    expectedMinor: minorUnitsSchema.nullable(),
    differenceMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'VoucherPreview' });

export type VoucherPreview = z.infer<typeof voucherPreviewSchema>;

/**
 * `POST /api/drafts/:id/post` and `/approve` (S03, S11 rule 13): a count's expected amount as its
 * preview showed it; the posting refuses the count when the box's balance has changed since
 * (`CASH_COUNT_STALE`). Other drafts send nothing.
 */
export const postDraftSchema = z
  .object({ expectedMinor: minorUnitsSchema.nullable().default(null) })
  // No body at all, as S03's clients post, is an empty one.
  .prefault({})
  .meta({ id: 'PostDraft' });

export type PostDraft = z.infer<typeof postDraftSchema>;

/** A voucher's number as printed: `<fiscal year>/<number>` in its kind (S11 "Arabic strings"). */
export const voucherNumberSchema = z
  .object({
    kind: voucherKindSchema,
    fiscalYear: z.int().min(2000).max(9999),
    number: z.int().min(1),
  })
  .meta({ id: 'VoucherNumber' });

export type VoucherNumber = z.infer<typeof voucherNumberSchema>;
