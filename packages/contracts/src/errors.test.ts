import { describe, expect, it } from 'vitest';
import {
  DomainError,
  errorCodeSchema,
  errorCodes,
  errorResponseSchema,
  errorStatus,
} from './errors.js';

describe('error codes', () => {
  it('are upper snake case and unique', () => {
    for (const code of errorCodes) expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  it('each map to a client or server error status', () => {
    for (const code of errorCodes) {
      expect(errorStatus[code]).toBeGreaterThanOrEqual(400);
      expect(errorStatus[code]).toBeLessThan(600);
    }
  });

  // Codes are stable and never renamed, removed or reused (ADR 0006): Hub reads them. This list is
  // append-only like the registry: a new code is added at the end of both, in the same order, and
  // a line is never edited or deleted.
  it('keep every code published so far, in order, with its status', () => {
    expect(Object.entries(errorStatus)).toEqual([
      // PR 2, money (ADR 0007)
      ['AMOUNT_OUT_OF_RANGE', 422],
      ['INVALID_RATE', 422],
      ['RATE_PAIR_MISMATCH', 422],
      ['CROSS_RATE_MISMATCH', 422],
      ['RATE_MISSING', 422],
      ['SYP_BEFORE_REDENOMINATION', 422],
      // PR 3, ledger (ADR 0005, ADR 0007)
      ['ENTRY_UNBALANCED', 422],
      ['ENTRY_TOO_FEW_LINES', 422],
      ['RELEASE_EXCEEDS_BALANCE', 422],
      // S01, companies, people and access
      ['VALIDATION_FAILED', 422],
      ['UNAUTHENTICATED', 401],
      ['INVALID_CREDENTIALS', 401],
      ['INVALID_TWO_FACTOR_CODE', 401],
      ['TWO_FACTOR_REQUIRED', 403],
      ['REAUTHENTICATION_REQUIRED', 403],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['COMPANY_NOT_SELECTED', 409],
      ['COMPANY_SWITCHED', 409],
      ['COMPANY_ARCHIVED', 409],
      ['COMPANY_SETTINGS_LOCKED', 409],
      ['LAST_OWNER', 409],
      ['MEMBERSHIP_EXISTS', 409],
      ['INVITATION_EXISTS', 409],
      ['LINK_INVALID', 410],
      ['INVITATION_EMAIL_MISMATCH', 403],
      ['RESET_NOT_ALLOWED', 403],
      ['RATE_LIMITED', 429],
      // S02, chart of accounts, dimensions and rates
      ['ACCOUNT_CODE_INVALID', 422],
      ['ACCOUNT_CODE_TAKEN', 409],
      ['ACCOUNT_NOT_HEADER', 422],
      ['ACCOUNT_NOT_POSTABLE', 422],
      ['ACCOUNT_LOCKED', 409],
      ['ACCOUNT_HAS_CHILDREN', 409],
      ['ACCOUNT_HAS_BALANCE', 409],
      ['ACCOUNT_IN_ROLE', 409],
      ['ACCOUNT_ROLE_INVALID', 422],
      ['ACCOUNT_ROLE_MISSING', 422],
      ['ACCOUNT_BLOCKED', 422],
      ['ACCOUNT_ARCHIVED', 422],
      ['ACCOUNT_CURRENCY_MISMATCH', 422],
      ['STATEMENT_LINE_INVALID', 422],
      ['CHART_NOT_EMPTY', 409],
      ['DIMENSION_REQUIRED', 422],
      ['DIMENSION_VALUE_ARCHIVED', 422],
      ['DIMENSION_PARENT_MISMATCH', 422],
      ['DIMENSION_TYPE_LIMIT', 409],
      ['DIMENSION_TYPE_IN_USE', 409],
      ['DIMENSION_CODE_TAKEN', 409],
      ['DIMENSION_ALREADY_LINKED', 409],
      ['DIMENSION_LINK_TAKEN', 409],
      ['RATE_ORIENTATION', 422],
      ['RATE_UNCHANGED', 409],
      ['RATE_REASON_REQUIRED', 422],
      ['HOLIDAY_EXISTS', 409],
    ]);
  });

  it('are the only codes the schema accepts', () => {
    expect(errorCodeSchema.parse('RATE_MISSING')).toBe('RATE_MISSING');
    expect(errorCodeSchema.safeParse('SOMETHING_ELSE').success).toBe(false);
  });
});

describe('DomainError', () => {
  it('is an Error with its code, message and details', () => {
    const error = new DomainError('RATE_MISSING', 'No bulletin rate', { on: '2026-10-20' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('RATE_MISSING');
    expect(error.message).toBe('No bulletin rate');
    expect(error.details).toEqual({ on: '2026-10-20' });
  });

  it('answer with the status, a known code and the failed fields', () => {
    const answer = {
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      issues: [{ path: ['email'], message: 'Invalid email address' }],
    };
    expect(errorResponseSchema.parse(answer)).toEqual(answer);
    expect(errorResponseSchema.safeParse({ ...answer, code: 'SOMETHING_ELSE' }).success).toBe(
      false,
    );
    const missing = {
      statusCode: 422,
      code: 'RATE_MISSING',
      message: 'No bulletin',
      details: { publicationDay: '2026-11-08' },
    };
    expect(errorResponseSchema.parse(missing)).toEqual(missing);
  });
});
