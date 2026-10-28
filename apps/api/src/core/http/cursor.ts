import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CodedException } from '../errors/coded-exception.js';

/** A row of a page ordered newest first by `(created_at, id)`. */
export interface Position {
  createdAt: Date;
  id: string;
}

/** The row after which the next page starts. */
export interface Cursor {
  id: string;
}

const cursorSchema = z.object({ id: z.uuid() });

/** The opaque cursor of the row after which the next page starts. */
export function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify({ id: position.id })).toString('base64url');
}

/** The row a cursor names; a cursor the API did not make answers `VALIDATION_FAILED`. */
export function decodeCursor(cursor: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
  } catch {
    throw new CodedException('VALIDATION_FAILED', 'Unknown cursor', [
      { path: ['cursor'], message: 'Unknown cursor' },
    ]);
  }
}

/**
 * The rows after the cursor's row, newest first by `(created_at, id)`. The cursor's `created_at`
 * is read in the database: PostgreSQL keeps microseconds and a `Date` only milliseconds, so a
 * time carried through JavaScript would skip the rows of the same millisecond.
 */
export function afterCursor(createdAt: AnyColumn, id: AnyColumn, cursor: Cursor): SQL {
  return sql`(${createdAt}, ${id}) < (select ${createdAt}, ${id} from ${id.table} where ${id} = ${cursor.id})`;
}

/** A page of `size` rows and the cursor of the next, from `size + 1` rows read. */
export function pageOf<Row extends Position, Entry>(
  rows: Row[],
  size: number,
  toEntry: (row: Row) => Entry,
): { entries: Entry[]; nextCursor: string | null } {
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return {
    entries: page.map(toEntry),
    nextCursor: rows.length > size && last ? encodeCursor(last) : null,
  };
}
