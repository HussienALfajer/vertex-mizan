import { z } from 'zod';

/**
 * Stable error codes (ADR 0006), with the HTTP status the API answers with. A code is never
 * renamed, removed or reused: Hub and other integrators read it. New codes go at the end, with a
 * line in the list in `errors.test.ts`; each feature adds the codes of its rules. Front ends show
 * the Arabic text of the code through i18n; `message` is English and for logs only.
 */
export const errorStatus = {
  // Money (ADR 0007).
  /** An amount or a conversion result outside the PostgreSQL `bigint` range. */
  AMOUNT_OUT_OF_RANGE: 422,
  /** A rate that is not a positive decimal with up to 10 places, or quotes a currency in itself. */
  INVALID_RATE: 422,
  /** The rate (or a leg of a cross rate) does not convert between the two currencies. */
  RATE_PAIR_MISMATCH: 422,
  /** The two quotes of a cross rate differ in type, or one is effective after the entry date. */
  CROSS_RATE_MISMATCH: 422,
  /**
   * A ledger's policy rate is missing for the date. A Hub event is held with this reason (`202`,
   * ADR 0008); a manual posting is refused with it.
   */
  RATE_MISSING: 422,
  /** An SYP amount or rate dated before 2026-01-01 (the new pound). */
  SYP_BEFORE_REDENOMINATION: 422,

  // Ledger (ADR 0005, ADR 0007).
  /**
   * An entry out of balance in a ledger beyond conversion rounding: lines that do not balance, or
   * an exchange residual that its posting rule did not post as a difference line.
   */
  ENTRY_UNBALANCED: 422,
  /** An entry with fewer than two lines (ADR 0005, invariant 1). */
  ENTRY_TOO_FEW_LINES: 422,
  /**
   * A release, clearing or settlement beyond what remains of a carried balance, such as a payment
   * above an invoice's open amount (ADR 0005, invariant 9).
   */
  RELEASE_EXCEEDS_BALANCE: 422,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorStatus;

export const errorCodes = Object.keys(errorStatus) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(errorCodes).meta({ id: 'ErrorCode' });

/** A refusal by a business rule; the API maps it to `errorStatus[code]`. */
export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
