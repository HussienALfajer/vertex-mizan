import { type ErrorCode, type ErrorResponse, errorResponseSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';

/** A refused request: its status and, when the API named one, its stable code (ADR 0006). */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode | undefined,
    readonly issues: ErrorResponse['issues'],
    /** Facts the refusal names, such as the publication day of `RATE_MISSING`. */
    readonly details: ErrorResponse['details'] = undefined,
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
  /**
   * The company the page shows, sent as `X-Mizan-Company` on every company request (S01 rule 22):
   * the API refuses it with `COMPANY_SWITCHED` when another tab switched the session's company,
   * so a write never lands in, and a read never answers for, another company.
   */
  company?: string;
  /** The answer's schema; without one the answer is ignored (204). */
  schema?: { parse(value: unknown): T };
}

/**
 * Calls the internal API (`/api`) with the session cookie and parses the answer with the
 * contract's schema. A refusal throws `ApiError` with its code.
 */
export async function api<T = void>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  { body, company, schema }: Request<T> = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(company === undefined ? {} : { 'x-mizan-company': company }),
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
    ? new ApiError(response.status, parsed.data.code, parsed.data.issues, parsed.data.details)
    : new ApiError(response.status, undefined, undefined);
}

/** An answer that is a list: each item parsed with the contract's schema of one item. */
export function listOf<T>(item: { parse(value: unknown): T }): { parse(value: unknown): T[] } {
  return {
    parse: (value) => {
      if (!Array.isArray(value)) throw new TypeError('Expected a list');
      return value.map((entry) => item.parse(entry));
    },
  };
}

/**
 * Uploads one file as the `file` field of a multipart body (an attachment, S03 rule 17), with the
 * company header, and parses the answer with the contract's schema.
 */
export async function upload<T>(
  path: string,
  file: File,
  { company, schema }: { company: string; schema: { parse(value: unknown): T } },
): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'x-mizan-company': company },
    body,
  });
  if (!response.ok) throw await refusal(response);
  return schema.parse(await response.json());
}

/** The file name of a `Content-Disposition` header: RFC 5987's UTF-8 form first, then the plain one. */
export function dispositionFileName(header: string | null): string | undefined {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed name falls back to the plain one.
    }
  }
  return /filename="([^"]+)"/.exec(header ?? '')?.[1];
}

/**
 * Downloads a file answer (an export, an attachment) with the session cookie and the company header, then hands
 * it to the browser under the name the API gave in `Content-Disposition`.
 */
export async function download(path: string, { company }: { company: string }): Promise<void> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'x-mizan-company': company },
  });
  if (!response.ok) throw await refusal(response);
  const name = dispositionFileName(response.headers.get('content-disposition'));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name ?? 'export';
  link.click();
  URL.revokeObjectURL(url);
}
