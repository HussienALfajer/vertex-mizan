import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { type ErrorCode, errorResponseSchema, errorStatus } from '@vertex-mizan/contracts';

/**
 * Documents a route's error answers (S01 "API"): one response per status, with the
 * `ErrorResponse` schema and the codes it may carry. Every authenticated route also answers
 * `UNAUTHENTICATED`; list it like the others.
 */
export function ApiErrors(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = errorStatus[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ...[...byStatus].map(([status, listed]) =>
      ApiResponse({
        status,
        description: listed.join(', '),
        standardSchema: errorResponseSchema,
      }),
    ),
  );
}

/** What the guard answers on every company read (S01 "Rules of the guard"). */
export const COMPANY_READ_ERRORS = [
  'UNAUTHENTICATED',
  'TWO_FACTOR_REQUIRED',
  'FORBIDDEN',
  'COMPANY_NOT_SELECTED',
  'COMPANY_SWITCHED',
] as const satisfies readonly ErrorCode[];

/** What the guard and the company lock answer on every company write, with a refused body. */
export const COMPANY_WRITE_ERRORS = [
  ...COMPANY_READ_ERRORS,
  'COMPANY_ARCHIVED',
  'VALIDATION_FAILED',
] as const satisfies readonly ErrorCode[];
