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

  // Chart of accounts, dimensions and rates (S02).
  /** The code breaks the 1-2-3-6 shape (ADR 0011) or does not start with its parent's code. */
  ACCOUNT_CODE_INVALID: 422,
  /** Another account of the company has the code. */
  ACCOUNT_CODE_TAKEN: 409,
  /** The parent is a postable account: only a header account has children. */
  ACCOUNT_NOT_HEADER: 422,
  /** A header account on a line, or blocked; only a postable account carries lines. */
  ACCOUNT_NOT_POSTABLE: 422,
  /** A change to a locked field of an account used by a posted line (S02 rule 4). */
  ACCOUNT_LOCKED: 409,
  /** Archiving, or making postable, a header account with children. */
  ACCOUNT_HAS_CHILDREN: 409,
  /** Archiving an account with a balance or open items in a ledger. */
  ACCOUNT_HAS_BALANCE: 409,
  /** Blocking or archiving an account that holds an account role. */
  ACCOUNT_IN_ROLE: 409,
  /** The account does not fit the role (S02 rule 7). */
  ACCOUNT_ROLE_INVALID: 422,
  /** A posting needs an account role the company has not set. */
  ACCOUNT_ROLE_MISSING: 422,
  /** A line on a blocked account. */
  ACCOUNT_BLOCKED: 422,
  /** A line on an archived account. */
  ACCOUNT_ARCHIVED: 422,
  /** The line's transaction currency differs from the account's currency restriction. */
  ACCOUNT_CURRENCY_MISMATCH: 422,
  /** An unknown statement line, or one that does not fit the account's class. */
  STATEMENT_LINE_INVALID: 422,
  /** A template applied to a chart that holds more than the five root accounts. */
  CHART_NOT_EMPTY: 409,
  /** A dimension the account requires is missing on a line. */
  DIMENSION_REQUIRED: 422,
  /** An archived dimension value on a manual line. */
  DIMENSION_VALUE_ARCHIVED: 422,
  /** The contract belongs to another client, or a value's parent is of the wrong type. */
  DIMENSION_PARENT_MISMATCH: 422,
  /** More than 10 active dimension types. */
  DIMENSION_TYPE_LIMIT: 409,
  /** Archiving a dimension type an account requires, or a built-in type. */
  DIMENSION_TYPE_IN_USE: 409,
  /** The dimension type or value code is used. */
  DIMENSION_CODE_TAKEN: 409,
  /** The dimension value already has a Hub ID; the link never changes. */
  DIMENSION_ALREADY_LINKED: 409,
  /** Another value of the type holds the Hub ID. */
  DIMENSION_LINK_TAKEN: 409,
  /** The pair is held the other way round (ADR 0011). */
  RATE_ORIENTATION: 422,
  /** The same rate is already in force for that pair, type and date. */
  RATE_UNCHANGED: 409,
  /** A correction of a rate without a reason. */
  RATE_REASON_REQUIRED: 422,
  /** The date is already a bulletin holiday. */
  HOLIDAY_EXISTS: 409,
  /** A dealt rate no ledger of the company can use for the entry's pairs (S03 rule 13). */
  DEALT_RATE_NOT_ACCEPTED: 422,
  /** Only a manual entry that is not itself a reversal is reversed by hand (S03 rule 9). */
  ENTRY_NOT_REVERSIBLE: 409,
  /** The entry has a reversal already: an entry is reversed once (ADR 0005, invariant 3). */
  ENTRY_ALREADY_REVERSED: 409,
  /** A reversal dated before the entry it reverses (S03 rule 9). */
  REVERSAL_BEFORE_ORIGINAL: 422,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorStatus;

export const errorCodes = Object.keys(errorStatus) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(errorCodes).meta({ id: 'ErrorCode' });

/**
 * Every error answer of the API (S01): the status, the stable code (absent only on an unexpected
 * server error), an English message for logs, for `VALIDATION_FAILED` the fields that failed
 * (paths and messages, never the values sent) and, on some refusals, `details`.
 */
export const errorResponseSchema = z
  .object({
    statusCode: z.int(),
    code: errorCodeSchema.optional(),
    message: z.string(),
    issues: z
      .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
      .optional(),
    /** Facts a refusal names for its reader, such as the publication day of `RATE_MISSING`. */
    details: z.record(z.string(), z.string()).optional(),
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
