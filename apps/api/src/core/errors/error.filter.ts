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
import type { Response } from 'express';

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
    const [status, body] = this.answer(exception);
    response.status(status).json(body);
  }

  private answer(exception: unknown): [number, unknown] {
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
    this.logger.error(`Unexpected error: ${describeForLog(exception)}`);
    const body: ErrorResponse = { statusCode: 500, message: 'Internal server error' };
    return [500, body];
  }
}
