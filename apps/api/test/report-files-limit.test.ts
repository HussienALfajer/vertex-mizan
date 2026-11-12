import type { INestApplication } from '@nestjs/common';
import type { Database } from '@vertex-mizan/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from './app.js';
import { books, line, posted, today } from './books.js';
import { testDatabase } from './people.js';

// S09 rule 35's limit over HTTP: an Excel export of more rows than the limit answers
// `REPORT_TOO_LARGE` with the count, and writes no audit row. The limit is lowered for this file
// alone, so a few synthetic rows cross it.

vi.mock('@vertex-mizan/contracts', async (original) => ({
  ...(await original<typeof import('@vertex-mizan/contracts')>()),
  REPORT_EXCEL_ROW_LIMIT: 2,
}));

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('the Excel row limit (rule 35)', () => {
  it('refuses an export over it with the count, and audits none', async () => {
    const book = await books(app, db);
    await posted(book.owner.browser, {
      entryDate: today(),
      description: 'رأس المال',
      reference: null,
      dealtRates: [],
      lines: [line(book, '111003', 'SYP', '100000000'), line(book, '311001', 'SYP', '-100000000')],
    });
    const from = `${today().slice(0, 7)}-01`;
    const answer = await book.owner.browser.get('/api/reports/journal_book/export', {
      format: 'xlsx',
      from,
      to: today(),
    });
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({
      code: 'REPORT_TOO_LARGE',
      details: { rows: '3', limit: '2' },
    });
  });
});
