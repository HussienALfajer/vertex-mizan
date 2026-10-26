import { z } from 'zod';
import { CodedException } from '../errors/coded-exception.js';

/** A position in a page ordered newest first by `(created_at, id)`. */
export interface Position {
  createdAt: Date;
  id: string;
}

const positionSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() });

/** The opaque cursor of the row after which the next page starts. */
export function encodeCursor(position: Position): string {
  const json = JSON.stringify({ createdAt: position.createdAt.toISOString(), id: position.id });
  return Buffer.from(json).toString('base64url');
}

/** The position a cursor names; a cursor the API did not make answers `VALIDATION_FAILED`. */
export function decodeCursor(cursor: string): Position {
  try {
    const parsed = positionSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new CodedException('VALIDATION_FAILED', 'Unknown cursor', [
      { path: ['cursor'], message: 'Unknown cursor' },
    ]);
  }
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
