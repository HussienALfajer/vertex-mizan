import type { INestApplication } from '@nestjs/common';
import type { Account, CreateCompany, DraftLineInput, Role } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { expect } from 'vitest';
import { todayInDamascus } from '../src/core/clock/today.js';
import type { Browser } from './browser.js';
import { joinCompany, newCompany, signedInPerson, type TestPerson } from './people.js';

// A company with books for the entry and draft tests (S03): Vertex Media's ledgers (SYP books at
// the bulletin, a USD parallel ledger at market accepting the dealt rate), the service-agency
// chart, a bulletin of 121.5000 and a market rate of 122.0000 SYP per USD for today, every day a
// publication day so today needs its own bulletin. Entries are dated today, by the API's clock.
// Every value is synthetic.

export const today = () => todayInDamascus();

export interface Books {
  owner: { browser: Browser; person: TestPerson };
  companyId: string;
  /** Account ids by code. */
  accounts: Map<string, string>;
  /** The rate rows recorded for today. */
  rates: { bulletin: string; market: string };
  join: (role: Role) => Promise<{ browser: Browser; person: { id: string } }>;
}

export async function books(
  app: INestApplication,
  db: Database,
  values: Partial<CreateCompany> = {},
): Promise<Books> {
  const owner = await signedInPerson(app, db);
  const company = await newCompany(owner.browser, { template: 'service-agency', ...values });
  const calendar = await owner.browser.put('/api/rate-calendar', { daysOff: [] });
  expect(calendar.status, JSON.stringify(calendar.body)).toBe(200);
  const rates = { bulletin: '', market: '' };
  for (const [type, rate] of [
    ['bulletin', '121.5000'],
    ['market', '122.0000'],
  ] as const) {
    const recorded = await owner.browser.post('/api/rates', {
      effectiveOn: today(),
      base: 'USD',
      quote: 'SYP',
      rate,
      type,
      source: 'manual',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    rates[type] = recorded.body.rate.id;
  }
  const chart = await owner.browser.get('/api/accounts');
  const accounts = new Map((chart.body as Account[]).map((account) => [account.code, account.id]));
  return {
    owner,
    companyId: company.id,
    accounts,
    rates,
    join: (role) => joinCompany(app, db, company.id, role),
  };
}

/** A typed line: the account by code, the amount in minor units as text. */
export const line = (
  book: Books,
  code: string,
  currency: 'USD' | 'SYP',
  amountMinor: string,
  memo: string | null = null,
): DraftLineInput => ({
  accountId: book.accounts.get(code) ?? null,
  dimensionValueIds: [],
  currency,
  amountMinor,
  memo,
});

/**
 * S03's example: 100.00 USD bought for 12,250.00 SYP from the SYP bank, dealt at 122.5000; book
 * 12,150.00 SYP at the bulletin and a 100.00 SYP realised loss in the book ledger only.
 */
export const purchase = (book: Books, dealt = true) => ({
  entryDate: today(),
  description: 'شراء دولار',
  reference: null,
  dealtRates: dealt ? [{ base: 'USD', quote: 'SYP', rate: '122.5000' }] : [],
  lines: [line(book, '111004', 'USD', '10000'), line(book, '111003', 'SYP', '-1225000')],
});

/** Creates a draft as `browser` and answers it. */
export async function draftOf(browser: Browser, input: object) {
  const created = await browser.post('/api/drafts', input);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { id: string; updatedAt: string };
}

/** Creates and posts a draft (approval off), answering the posted entry. */
export async function posted(browser: Browser, input: object) {
  const draft = await draftOf(browser, input);
  const result = await browser.post(`/api/drafts/${draft.id}/post`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.entry as { id: string; fiscalYear: number; number: number };
}

/** A small file of each type, by its first bytes. */
export const files = {
  pdf: Buffer.from('%PDF-1.7\n% ملف تجريبي\n%%EOF\n'),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  html: Buffer.from('<html><script>alert(1)</script></html>'),
};
