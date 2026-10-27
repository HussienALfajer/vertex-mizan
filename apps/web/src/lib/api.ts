import { type ErrorCode, type ErrorResponse, errorResponseSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';

/** A refused request: its status and, when the API named one, its stable code (ADR 0006). */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode | undefined,
    readonly issues: ErrorResponse['issues'],
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

/** Whether a failure is the API refusing with this code. */
export function hasCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof ApiError && error.code === code;
}

/** The Arabic text of a failure: its code's text, or the generic one. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.code) return ar.errors[error.code];
  return ar.common.errorDescription;
}

interface Request<T> {
  body?: unknown;
  /** The answer's schema; without one the answer is ignored (204). */
  schema?: { parse(value: unknown): T };
}

/**
 * Calls the internal API (`/api`) with the session cookie and parses the answer with the
 * contract's schema. A refusal throws `ApiError` with its code.
 */
export async function api<T = void>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  { body, schema }: Request<T> = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await refusal(response);
  if (!schema) return undefined as T;
  return schema.parse(await response.json());
}

async function refusal(response: Response): Promise<ApiError> {
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success
    ? new ApiError(response.status, parsed.data.code, parsed.data.issues)
    : new ApiError(response.status, undefined, undefined);
}
