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

  // Companies, people and access (S01).
  /** The request does not match its schema (ADR 0008: validation answers 422). */
  VALIDATION_FAILED: 422,
  /** No valid session. */
  UNAUTHENTICATED: 401,
  /** Wrong email or password, or a locked or archived account: one answer for all. */
  INVALID_CREDENTIALS: 401,
  /** A wrong, reused or expired authenticator or backup code. */
  INVALID_TWO_FACTOR_CODE: 401,
  /** The person must enrol two-factor first. */
  TWO_FACTOR_REQUIRED: 403,
  /** A sensitive action without a fresh authenticator or backup code (5 minutes). */
  REAUTHENTICATION_REQUIRED: 403,
  /** The membership lacks the route's permission. */
  FORBIDDEN: 403,
  /** Unknown, or belongs to another company: the two answer alike. */
  NOT_FOUND: 404,
  /** No active company on the session. */
  COMPANY_NOT_SELECTED: 409,
  /** The `X-Mizan-Company` header differs from the session's active company. */
  COMPANY_SWITCHED: 409,
  /** A write to an archived company. */
  COMPANY_ARCHIVED: 409,
  /** A change to the currencies, rate policies or fiscal year after the first posted entry. */
  COMPANY_SETTINGS_LOCKED: 409,
  /** The change would leave the company without an active owner. */
  LAST_OWNER: 409,
  /** The invited email already belongs to a member of the company. */
  MEMBERSHIP_EXISTS: 409,
  /** A pending invitation exists for the email and company. */
  INVITATION_EXISTS: 409,
  /** An invitation or reset link that is expired, used or revoked. */
  LINK_INVALID: 410,
  /** The signed-in person is not the invited email. */
  INVITATION_EMAIL_MISMATCH: 403,
  /** The person belongs to a company where the resetting owner is not an owner. */
  RESET_NOT_ALLOWED: 403,
  /** Too many attempts. */
  RATE_LIMITED: 429,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorStatus;

export const errorCodes = Object.keys(errorStatus) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(errorCodes).meta({ id: 'ErrorCode' });

/**
 * Every error answer of the API (S01): the status, the stable code (absent only on an unexpected
 * server error), an English message for logs and, for `VALIDATION_FAILED`, the fields that failed
 * (paths and messages, never the values sent).
 */
export const errorResponseSchema = z
  .object({
    statusCode: z.int(),
    code: errorCodeSchema.optional(),
    message: z.string(),
    issues: z
      .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
      .optional(),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

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
