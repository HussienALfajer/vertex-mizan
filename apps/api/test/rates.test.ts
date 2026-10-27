import type { INestApplication } from '@nestjs/common';
import type { CreateCompany } from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// The rate table and the bulletin calendar (S02 rules 14–18) through the API, with S02's
// acceptance steps 5–7. Every rate and date is synthetic. 2026-11-04 is a Wednesday.

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

async function owner(values: Partial<CreateCompany> = {}) {
  const person = await signedInPerson(app, db);
  const company = await newCompany(person.browser, values);
  return { ...person, company };
}

const bulletin = (effectiveOn: string, rate: string, extra: object = {}) => ({
  effectiveOn,
  base: 'USD',
  quote: 'SYP',
  rate,
  type: 'bulletin',
  source: 'manual',
  ...extra,
});

const inForce = (browser: Browser, type: string, on: string, from = 'USD', to = 'SYP') =>
  browser.get('/api/rates/in-force', { type, from, to, on });

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

describe('the guard on every rate route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/rates' },
      {
        method: 'get',
        path: '/api/rates/in-force',
        query: { type: 'market', from: 'USD', to: 'SYP', on: '2026-11-04' },
      },
      { method: 'post', path: '/api/rates' },
      { method: 'get', path: '/api/rate-pairs' },
      { method: 'post', path: '/api/rate-pairs' },
      { method: 'get', path: '/api/rate-calendar' },
      { method: 'put', path: '/api/rate-calendar' },
      { method: 'post', path: '/api/rate-calendar/holidays' },
      { method: 'post', path: `/api/rate-calendar/holidays/${uuidv7()}/remove` },
    ]);
  });
});

describe('the bulletin of the day (acceptance steps 5–6, rule 16)', () => {
  it('takes the last bulletin on a holiday and days off, and none on a working day without one', async () => {
    const { browser, company } = await owner();
    const calendar = await browser.get('/api/rate-calendar');
    expect(calendar.body).toEqual({ daysOff: [5, 6], holidays: [] });
    const holiday = await browser.post('/api/rate-calendar/holidays', {
      on: '2026-11-05',
      note: 'عطلة تجريبية',
    });
    expect(holiday.status).toBe(201);

    const recorded = await browser.post('/api/rates', bulletin('2026-11-04', '120.0000'));
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    expect(recorded.body.rate).toMatchObject({
      rate: '120',
      source: 'manual',
      superseded: false,
      recordedBy: { kind: 'person', name: expect.any(String) },
    });
    expect(recorded.body.superseded).toBeNull();
    const market = await browser.post('/api/rates', {
      ...bulletin('2026-11-04', '125.5000'),
      type: 'market',
    });
    expect(market.status).toBe(201);

    for (const on of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) {
      const answer = await inForce(browser, 'bulletin', on);
      expect(answer.status, on).toBe(200);
      expect(answer.body.rows[0]).toMatchObject({ effectiveOn: '2026-11-04', rate: '120' });
      expect(answer.body.via).toBeNull();
    }
    const sunday = await inForce(browser, 'bulletin', '2026-11-08');
    expect(sunday.status).toBe(422);
    expect(sunday.body).toMatchObject({
      code: 'RATE_MISSING',
      details: { publicationDay: '2026-11-08' },
    });
    // A rate converts both ways, from its quote currency by dividing.
    expect((await inForce(browser, 'bulletin', '2026-11-05', 'SYP', 'USD')).status).toBe(200);
    const marketSunday = await inForce(browser, 'market', '2026-11-08');
    expect(marketSunday.body.rows[0].rate).toBe('125.5');
    expect((await inForce(browser, 'market', '2026-11-03')).body.code).toBe('RATE_MISSING');

    const log = await actions(company.id);
    for (const action of ['bulletin_holiday.added', 'rate_pair.created', 'rate.recorded']) {
      expect(log).toContain(action);
    }
  });

  it('crosses a third currency through the other ledger currency (ADR 0007)', async () => {
    const { browser } = await owner();
    for (const rate of [
      { base: 'TRY', quote: 'SYP', rate: '3.5' },
      { base: 'USD', quote: 'SYP', rate: '120' },
    ]) {
      const answer = await browser.post('/api/rates', {
        ...rate,
        effectiveOn: '2026-11-04',
        type: 'market',
        source: 'manual',
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    }
    const cross = await inForce(browser, 'market', '2026-11-04', 'TRY', 'USD');
    expect(cross.status, JSON.stringify(cross.body)).toBe(200);
    expect(cross.body.via).toBe('SYP');
    expect(cross.body.rows.map((row: { base: string }) => row.base)).toEqual(['TRY', 'USD']);
  });
});

describe('recording and correcting (acceptance step 7, rules 14–15)', () => {
  it('keeps one orientation, asks a correction for a reason and chains it', async () => {
    const { browser, company } = await owner();
    const first = await browser.post('/api/rates', bulletin('2026-11-04', '120.0000'));
    const inverted = await browser.post('/api/rates', {
      ...bulletin('2026-11-04', '0.0083'),
      base: 'SYP',
      quote: 'USD',
    });
    expect(inverted.body.code).toBe('RATE_ORIENTATION');
    expect((await browser.post('/api/rates', bulletin('2026-11-04', '120'))).body.code).toBe(
      'RATE_UNCHANGED',
    );
    const noReason = await browser.post('/api/rates', bulletin('2026-11-04', '121.0000'));
    expect(noReason.body.code).toBe('RATE_REASON_REQUIRED');
    const corrected = await browser.post(
      '/api/rates',
      bulletin('2026-11-04', '121.0000', { reason: 'خطأ في الإدخال' }),
    );
    expect(corrected.status).toBe(201);
    expect(corrected.body.rate).toMatchObject({
      rate: '121',
      supersedesRateId: first.body.rate.id,
      reason: 'خطأ في الإدخال',
    });
    expect(corrected.body.superseded).toMatchObject({ id: first.body.rate.id, superseded: true });
    expect((await inForce(browser, 'bulletin', '2026-11-04')).body.rows[0].rate).toBe('121');
    expect(
      (await browser.post('/api/rates', bulletin('2026-11-04', '121', { reason: 'مكرر' }))).body
        .code,
    ).toBe('RATE_UNCHANGED');
    const again = await browser.post(
      '/api/rates',
      bulletin('2026-11-04', '122', { reason: 'تصحيح ثان' }),
    );
    expect(again.body.rate.supersedesRateId).toBe(corrected.body.rate.id);
    expect(
      (await browser.post('/api/rates', bulletin('2026-11-09', '123', { reason: 'لا شيء' }))).body
        .code,
    ).toBe('VALIDATION_FAILED');

    const listed = await browser.get('/api/rates', { base: 'USD', quote: 'SYP', type: 'bulletin' });
    expect(listed.body.rates.map((row: { rate: string }) => row.rate)).toEqual([
      '122',
      '121',
      '120',
    ]);
    expect(listed.body.rates.map((row: { superseded: boolean }) => row.superseded)).toEqual([
      false,
      true,
      true,
    ]);
    const log = await actions(company.id);
    expect(log.filter((action) => action === 'rate.corrected')).toHaveLength(2);
  });

  it('refuses an SYP rate before the new pound, a currency quoted in itself and a zero rate', async () => {
    const { browser } = await owner();
    expect((await browser.post('/api/rates', bulletin('2025-12-31', '120'))).body.code).toBe(
      'SYP_BEFORE_REDENOMINATION',
    );
    expect(
      (await browser.post('/api/rates', { ...bulletin('2026-11-04', '1'), quote: 'USD' })).body
        .code,
    ).toBe('INVALID_RATE');
    expect((await browser.post('/api/rates', bulletin('2026-11-04', '0'))).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await browser.post('/api/rates', bulletin('2026-11-04', '1.12345678901'))).body.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('answers a double submit once', async () => {
    const { browser } = await owner();
    const answers = await Promise.all([
      browser.post('/api/rates', bulletin('2026-11-04', '120')),
      browser.post('/api/rates', bulletin('2026-11-04', '120')),
    ]);
    expect(
      answers.map((answer) => (answer.status === 201 ? 201 : answer.body.code)).sort(),
    ).toEqual([201, 'RATE_UNCHANGED']);
  });

  it('pages the rows newest first', async () => {
    const { browser, company } = await owner();
    for (let day = 1; day <= 30; day += 1) {
      for (const [base, quote] of [
        ['USD', 'SYP'],
        ['EUR', 'SYP'],
        ['TRY', 'SYP'],
        ['EUR', 'USD'],
      ] as const) {
        const answer = await browser.post('/api/rates', {
          effectiveOn: `2026-11-${String(day).padStart(2, '0')}`,
          base,
          quote,
          rate: `${100 + day}`,
          type: 'market',
          source: 'manual',
        });
        expect(answer.status).toBe(201);
      }
    }
    const first = await browser.get('/api/rates');
    expect(first.body.rates).toHaveLength(100);
    const second = await browser.get('/api/rates', { cursor: first.body.nextCursor });
    expect(second.body.rates).toHaveLength(20);
    expect(second.body.nextCursor).toBeNull();
    const window = await browser.get('/api/rates', {
      base: 'EUR',
      quote: 'USD',
      from: '2026-11-10',
      to: '2026-11-12',
    });
    expect(window.body.rates.map((row: { effectiveOn: string }) => row.effectiveOn)).toEqual([
      '2026-11-12',
      '2026-11-11',
      '2026-11-10',
    ]);
    expect((await browser.get('/api/rate-pairs')).body).toHaveLength(4);
    expect(company.id).toBeTruthy();
  });
});

describe('rate pairs and the calendar (rule 17)', () => {
  it('adds a pair once in one orientation', async () => {
    const { browser } = await owner();
    const pair = await browser.post('/api/rate-pairs', { base: 'EUR', quote: 'SYP' });
    expect(pair.status).toBe(201);
    expect((await browser.post('/api/rate-pairs', { base: 'EUR', quote: 'SYP' })).body.id).toBe(
      pair.body.id,
    );
    expect((await browser.post('/api/rate-pairs', { base: 'SYP', quote: 'EUR' })).body.code).toBe(
      'RATE_ORIENTATION',
    );
    expect((await browser.post('/api/rate-pairs', { base: 'SYP', quote: 'SYP' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('changes the days off, adds a holiday once and removes it', async () => {
    const { browser, company } = await owner();
    await browser.post('/api/rates', bulletin('2026-11-06', '120'));
    // Friday only: Saturday 2026-11-07 then needs its own bulletin (edge case 8).
    const changed = await browser.put('/api/rate-calendar', { daysOff: [5] });
    expect(changed.body.daysOff).toEqual([5]);
    expect((await inForce(browser, 'bulletin', '2026-11-07')).body.code).toBe('RATE_MISSING');
    expect(
      (await browser.put('/api/rate-calendar', { daysOff: [1, 2, 3, 4, 5, 6, 7] })).body.code,
    ).toBe('VALIDATION_FAILED');
    const holiday = await browser.post('/api/rate-calendar/holidays', {
      on: '2026-11-07',
      note: 'عطلة',
    });
    expect((await inForce(browser, 'bulletin', '2026-11-07')).body.rows[0].effectiveOn).toBe(
      '2026-11-06',
    );
    expect(
      (await browser.post('/api/rate-calendar/holidays', { on: '2026-11-07', note: 'مكرر' })).body
        .code,
    ).toBe('HOLIDAY_EXISTS');
    const removed = await browser.post(`/api/rate-calendar/holidays/${holiday.body.id}/remove`);
    expect(removed.status).toBe(200);
    expect((await browser.get('/api/rate-calendar')).body.holidays).toEqual([]);
    expect(
      (await browser.post(`/api/rate-calendar/holidays/${holiday.body.id}/remove`)).body.code,
    ).toBe('NOT_FOUND');
    expect(
      (await browser.post('/api/rate-calendar/holidays', { on: '2026-11-07', note: 'من جديد' }))
        .status,
    ).toBe(201);
    const log = await actions(company.id);
    expect(log).toContain('rate_calendar.updated');
    expect(log).toContain('bulletin_holiday.removed');
  });
});

describe('isolation and roles', () => {
  it("never shows another company's rates, pairs or holidays", async () => {
    const mine = await owner();
    const theirs = await owner();
    await theirs.browser.post('/api/rates', bulletin('2026-11-04', '120'));
    const holiday = await theirs.browser.post('/api/rate-calendar/holidays', {
      on: '2026-11-05',
      note: 'عطلتهم',
    });
    expect((await mine.browser.get('/api/rates')).body.rates).toEqual([]);
    expect((await mine.browser.get('/api/rate-pairs')).body).toEqual([]);
    expect((await inForce(mine.browser, 'bulletin', '2026-11-04')).body.code).toBe('RATE_MISSING');
    expect(
      (await mine.browser.post(`/api/rate-calendar/holidays/${holiday.body.id}/remove`)).body.code,
    ).toBe('NOT_FOUND');
    expect((await theirs.browser.get('/api/rate-calendar')).body.holidays).toHaveLength(1);
    // The pair is per company: the reverse orientation is free in another company.
    const reverse = await mine.browser.post('/api/rate-pairs', { base: 'SYP', quote: 'USD' });
    expect(reverse.status).toBe(201);
  });

  it('lets every role read and only the owner and accountant record', async () => {
    const { company } = await owner();
    const approver = await joinCompany(app, db, company.id, 'approver');
    expect((await approver.browser.get('/api/rates')).status).toBe(200);
    expect((await approver.browser.post('/api/rates', bulletin('2026-11-04', '1'))).body.code).toBe(
      'FORBIDDEN',
    );
    const accountant = await joinCompany(app, db, company.id, 'accountant');
    expect((await accountant.browser.post('/api/rates', bulletin('2026-11-04', '1'))).status).toBe(
      201,
    );
  });
});
