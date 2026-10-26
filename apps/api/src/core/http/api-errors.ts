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
