import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  DomainError,
  type ErrorCode,
  type ErrorResponse,
  errorStatus,
} from '@vertex-mizan/contracts';
import { describeForLog } from '@vertex-mizan/db';
import type { Request, Response } from 'express';

/** Hub's opening snapshot, the one route with a larger body (S10 rule 6: at most 5 MB). */
export const OPENING_SNAPSHOT_PATH = '/v1/opening/snapshot';

/** `Retry-After` of `OPENING_NOT_POSTED` (S10 rule 3). */
export const OPENING_RETRY_AFTER_SECONDS = 3600;

/** The code of a framework refusal that carries none (an unknown route, a malformed body). */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/**
 * The status of a refusal by Express's body parser (`entity.too.large`, `entity.parse.failed`, an
 * unsupported charset), which reaches the filter as a plain error; null for anything else.
 */
function bodyParserStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { type, status } = exception as { type?: unknown; status?: unknown };
  const fromParser =
    typeof type === 'string' &&
    (type.startsWith('entity.') || type.startsWith('encoding.') || type === 'charset.unsupported');
  return fromParser && typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/**
 * Every error answer carries a stable code (S01, ADR 0006): a `CodedException` as thrown, a
 * `DomainError` with its code's status, the failed fields it names as `issues` and its other facts
 * as `details`, a framework refusal with the code of its status. A
 * server-side answer (the health check's 503) keeps its own body. Anything else is a 500 whose
 * cause is logged without its message, which can quote values.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const [status, body] = this.answer(exception, request.path);
    // Before the opening posts, an event is sent again in an hour (S10 rule 3).
    if (exception instanceof DomainError && exception.code === 'OPENING_NOT_POSTED') {
      response.setHeader('Retry-After', String(OPENING_RETRY_AFTER_SECONDS));
    }
    response.status(status).json(body);
  }

  private answer(exception: unknown, path: string): [number, unknown] {
    if (exception instanceof DomainError) {
      const { issues, ...facts } = exception.details ?? {};
      // The facts a refusal names (the ledger, pair and date of `RATE_MISSING`), as text.
      const details = Object.fromEntries(
        Object.entries(facts)
          .filter(([, value]) => ['string', 'number', 'bigint'].includes(typeof value))
          .map(([key, value]) => [key, String(value)]),
      );
      const body: ErrorResponse = {
        statusCode: errorStatus[exception.code],
        code: exception.code,
        message: exception.message,
        ...(Array.isArray(issues) && { issues: issues as NonNullable<ErrorResponse['issues']> }),
        ...(Object.keys(details).length > 0 && { details }),
      };
      return [body.statusCode, body];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) return [status, body];
      const code = CODE_BY_STATUS[status];
      if (!code) return [status, body];
      const coded: ErrorResponse = {
        statusCode: errorStatus[code],
        code,
        message: exception.message,
      };
      return [coded.statusCode, coded];
    }
    const parser = bodyParserStatus(exception);
    if (parser === HttpStatus.PAYLOAD_TOO_LARGE && path === OPENING_SNAPSHOT_PATH) {
      // Hub's snapshot over 5 MB is one of S10 rule 6's refusals.
      const body: ErrorResponse = {
        statusCode: errorStatus.VALIDATION_FAILED,
        code: 'VALIDATION_FAILED',
        message: 'The snapshot is larger than 5 MB',
        issues: [{ path: ['body'], message: 'At most 5 MB' }],
      };
      return [body.statusCode, body];
    }
    if (parser === HttpStatus.PAYLOAD_TOO_LARGE) {
      // The body limit (S05 rule 22): no code, as Hub's contract names the status alone.
      const body: ErrorResponse = { statusCode: parser, message: 'The body is too large' };
      return [parser, body];
    }
    if (parser !== null) {
      const body: ErrorResponse = {
        statusCode: errorStatus.VALIDATION_FAILED,
        code: 'VALIDATION_FAILED',
        message: 'The body is not readable JSON',
      };
      return [body.statusCode, body];
    }
    this.logger.error(`Unexpected error: ${describeForLog(exception)}`);
    const body: ErrorResponse = { statusCode: 500, message: 'Internal server error' };
    return [500, body];
  }
}
