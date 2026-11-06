import { z } from 'zod';
import { currencyCodeSchema } from './money.js';
import { MINOR_MAX, MINOR_MIN } from './money-arithmetic.js';

/**
 * The internal `/api`'s shared shapes (S03): an amount in minor units on the wire, an amount with
 * its currency, a person and an entry number. `entries.ts` re-exports them; they live here so the
 * open items (S04) use them without an import cycle with `entries.ts`.
 */

const MINOR_UNITS_PATTERN = /^(0|-?[1-9]\d{0,18})$/;

/**
 * An amount in minor units on the wire: an integer string (`"-1225000"`), because a JSON number
 * loses digits beyond 2^53; within the stored `bigint` range (ADR 0007).
 */
export const minorUnitsSchema = z
  .string()
  .regex(MINOR_UNITS_PATTERN, 'Expected an integer in minor units')
  .refine((text) => {
    // Zod runs a refinement even after a failed pattern: that case is the pattern's issue.
    if (!MINOR_UNITS_PATTERN.test(text)) return true;
    const value = BigInt(text);
    return value >= MINOR_MIN && value <= MINOR_MAX;
  }, 'Outside the stored range')
  .meta({
    id: 'MinorUnits',
    description: 'An integer amount in minor units of its currency, as a decimal string',
  });

/** An amount with its currency (ADR 0007): never shown or read without it. */
export const moneyAmountSchema = z
  .object({ amountMinor: minorUnitsSchema, currency: currencyCodeSchema })
  .meta({ id: 'MoneyAmount' });

export type MoneyAmount = z.infer<typeof moneyAmountSchema>;

/** A person named on a draft or an entry: who prepared, submitted, approved or posted it. */
export const personRefSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .meta({ id: 'PersonRef' });

export type PersonRef = z.infer<typeof personRefSchema>;

/** An entry's number as it is shown: fiscal year and number (`2026/123`, S03 "Periods"). */
export const entryNumberSchema = z
  .object({ fiscalYear: z.int().min(2000).max(9999), number: z.int().min(1) })
  .meta({ id: 'EntryNumber' });

export type EntryNumber = z.infer<typeof entryNumberSchema>;
