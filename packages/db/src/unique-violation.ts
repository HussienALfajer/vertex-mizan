import { DomainError, type ErrorCode } from '@vertex-mizan/contracts';
import { DrizzleQueryError } from 'drizzle-orm';

/** The constraint a failed write broke when it is a unique violation (SQLSTATE 23505). */
function uniqueConstraintOf(error: unknown): string | null {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof cause !== 'object' || cause === null) return null;
  const { code, constraint } = cause as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}

/**
 * Runs a write and answers a unique violation of one of `codes`' constraints with its code: two
 * requests at once both pass the check before the write, and the unique key decides (S02 edge
 * cases 1 and 2). Any other error is rethrown as it is.
 */
export async function onUniqueViolation<T>(
  write: () => Promise<T>,
  codes: Readonly<Record<string, ErrorCode>>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const constraint = uniqueConstraintOf(error);
    const code = constraint === null ? undefined : codes[constraint];
    if (code !== undefined) throw new DomainError(code, `Unique key ${constraint}`);
    throw error;
  }
}
