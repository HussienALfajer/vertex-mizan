import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeForLog } from '../src/index.js';

// What an unexpected error may write to the log: never the values a query or a row carried.

/** A database error as node-postgres builds it, with a message and detail quoting a value. */
function databaseError() {
  return Object.assign(new Error('duplicate key value violates unique constraint: 1250000'), {
    severity: 'ERROR',
    code: '23505',
    detail: 'Key (amount_minor)=(1250000) already exists.',
    table: 'fixture_lines',
    constraint: 'fixture_lines_pkey',
  });
}

describe('describeForLog', () => {
  it('keeps a database error’s code, table and constraint, never its message or detail', () => {
    const line = describeForLog(databaseError());
    expect(line).toBe('Database error 23505 on fixture_lines fixture_lines_pkey');
    expect(line).not.toMatch(/1250000/);
  });

  it('describes a failed Drizzle query by its cause, not by its parameters', () => {
    const failed = new DrizzleQueryError(
      'insert into fixture_lines values ($1)',
      [1250000],
      databaseError(),
    );
    expect(describeForLog(failed)).toBe('Database error 23505 on fixture_lines fixture_lines_pkey');
    expect(describeForLog(new DrizzleQueryError('select 1', []))).toBe('Query failed');
  });

  it('keeps the stack of any other error, and names what is not an error', () => {
    const error = new TypeError('a programming error');
    expect(describeForLog(error)).toBe(error.stack);
    expect(describeForLog('1250000')).toBe('Non-error thrown: string');
  });
});
