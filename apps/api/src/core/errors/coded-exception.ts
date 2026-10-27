import { HttpException } from '@nestjs/common';
import { type ErrorCode, type ErrorResponse, errorStatus } from '@vertex-mizan/contracts';

/** A Standard Schema issue, as the validation pipe reports it; Zod's carry their `params`. */
interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
  readonly params?: { readonly code?: unknown } | undefined;
}

/**
 * A refusal with a stable error code (ADR 0006): the status comes from `errorStatus`, the body is
 * an `ErrorResponse`. The message is English and for logs; the web shows the code's Arabic text.
 */
export class CodedException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    issues?: ErrorResponse['issues'],
    details?: ErrorResponse['details'],
  ) {
    const body: ErrorResponse = {
      statusCode: errorStatus[code],
      code,
      message,
      ...(issues && { issues }),
      ...(details && { details }),
    };
    super(body, errorStatus[code]);
  }
}

/** The failed fields of a schema: their paths and messages, never the values sent. */
export function issuesOf(issues: readonly SchemaIssue[]): ErrorResponse['issues'] {
  return issues.map((issue) => ({
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment;
      return typeof key === 'number' ? key : String(key);
    }),
    message: issue.message,
  }));
}

/**
 * The code of a failed schema: the one stable code its custom issues name in `params.code` (the
 * money module's `INVALID_RATE`, `SYP_BEFORE_REDENOMINATION`), otherwise `VALIDATION_FAILED`.
 */
export function codeOfIssues(issues: readonly SchemaIssue[]): ErrorCode {
  const named = new Set(
    issues
      .map((issue) => issue.params?.code)
      .filter((code): code is ErrorCode => typeof code === 'string' && code in errorStatus),
  );
  const [only] = named;
  return named.size === 1 && only !== undefined ? only : 'VALIDATION_FAILED';
}
