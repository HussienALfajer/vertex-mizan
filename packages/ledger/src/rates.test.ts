import { describe, expect, it } from 'vitest';
import { lastPublicationDay, type PublicationCalendar, policyRate, rateInForce } from './rates.js';
import { calendar, rate } from './test-fixtures.js';

// November 2026: Thursday 5, Friday 6, Saturday 7, Sunday 8, Monday 9, Tuesday 10.

describe('lastPublicationDay', () => {
  it('is the day itself on a working day, and the last working day before a day off', () => {
    expect(lastPublicationDay('2026-11-08', calendar)).toBe('2026-11-08');
    expect(lastPublicationDay('2026-11-06', calendar)).toBe('2026-11-05');
    expect(lastPublicationDay('2026-11-07', calendar)).toBe('2026-11-05');
  });

  it('skips holidays, across a weekend, a year end and a leap day', () => {
    const holidays: PublicationCalendar = {
      daysOff: [5, 6],
      holidays: ['2026-11-08', '2026-12-31', '2028-02-29'],
    };
    expect(lastPublicationDay('2026-11-08', holidays)).toBe('2026-11-05');
    expect(lastPublicationDay('2026-11-09', holidays)).toBe('2026-11-09');
    // Friday 2027-01-01 and a holiday on Thursday 2026-12-31: Wednesday 2026-12-30.
    expect(lastPublicationDay('2027-01-01', holidays)).toBe('2026-12-30');
    // Tuesday 2028-02-29 is a holiday: Monday 2028-02-28.
    expect(lastPublicationDay('2028-02-29', holidays)).toBe('2028-02-28');
    expect(lastPublicationDay('2028-03-01', holidays)).toBe('2028-03-01');
  });

  it('follows the days off the company sets, and is null when every day is off', () => {
    expect(lastPublicationDay('2026-11-07', { daysOff: [5], holidays: [] })).toBe('2026-11-07');
    expect(lastPublicationDay('2026-11-07', { daysOff: [], holidays: [] })).toBe('2026-11-07');
    const never = { daysOff: [1, 2, 3, 4, 5, 6, 7], holidays: [] };
    expect(lastPublicationDay('2026-11-07', never)).toBe(null);
  });
});

describe('rateInForce', () => {
  const table = [
    rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-05'),
    rate('USD', 'SYP', '125.0000', 'market', '2026-11-03'),
    rate('USD', 'SYP', '121.0000', 'bulletin', '2026-11-08'),
    // A correction recorded later for the same date and type.
    rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-08'),
    rate('USD', 'SYP', '122.2500', 'bulletin', '2026-11-10'),
  ];
  const bulletin = (on: string, at: PublicationCalendar = calendar) =>
    rateInForce(table, { type: 'bulletin', from: 'USD', to: 'SYP', on }, at)?.rate ?? null;

  it('takes a working day its own bulletin, the one recorded last for that date', () => {
    expect(bulletin('2026-11-05')).toBe('120.0000');
    expect(
      rateInForce(table, { type: 'bulletin', from: 'USD', to: 'SYP', on: '2026-11-08' }, calendar),
    ).toBe(table[3]);
    expect(bulletin('2026-11-10')).toBe('122.2500');
  });

  it("takes Friday and Saturday Thursday's bulletin, and a holiday the last published", () => {
    expect(bulletin('2026-11-06')).toBe('120.0000');
    expect(bulletin('2026-11-07')).toBe('120.0000');
    const sundayOff = { daysOff: [5, 6], holidays: ['2026-11-08', '2026-11-09'] };
    // A row recorded on a holiday is still the newest on or after P.
    expect(bulletin('2026-11-08', sundayOff)).toBe('121.5000');
    expect(bulletin('2026-11-09', sundayOff)).toBe('121.5000');
  });

  it('is missing on a working day without its own bulletin: never the day before', () => {
    expect(bulletin('2026-11-09')).toBe(null);
    expect(bulletin('2026-11-11')).toBe(null);
    expect(bulletin('2026-11-04')).toBe(null);
    expect(bulletin('2026-11-07', { daysOff: [5], holidays: [] })).toBe(null);
  });

  it('keeps the market rate the newest row on or before the date, whatever the calendar', () => {
    const market = (on: string, at: PublicationCalendar) =>
      rateInForce(table, { type: 'market', from: 'USD', to: 'SYP', on }, at)?.rate ?? null;
    expect(market('2026-11-11', calendar)).toBe('125.0000');
    expect(market('2026-11-11', { daysOff: [1, 2, 3, 4, 5, 6, 7], holidays: [] })).toBe('125.0000');
    expect(market('2026-11-02', calendar)).toBe(null);
  });

  it('serves the pair either way round, keeps types apart, and never defaults', () => {
    expect(
      rateInForce(table, { type: 'bulletin', from: 'SYP', to: 'USD', on: '2026-11-06' }, calendar)
        ?.rate,
    ).toBe('120.0000');
    expect(
      rateInForce(table, { type: 'bulletin', from: 'EUR', to: 'SYP', on: '2026-11-10' }, calendar),
    ).toBe(null);
  });
});

describe('policyRate', () => {
  const query = { from: 'TRY', to: 'SYP', on: '2026-11-10', via: 'USD' } as const;

  it('crosses a bulletin when the direct rate is not of the day and both quotes are', () => {
    const direct = rate('TRY', 'SYP', '2.9000', 'bulletin', '2026-11-05');
    const tryLeg = rate('USD', 'TRY', '41.0000', 'bulletin', '2026-11-10');
    const sypLeg = rate('USD', 'SYP', '122.0000', 'bulletin', '2026-11-10');
    expect(policyRate([direct, tryLeg, sypLeg], { ...query, type: 'bulletin' }, calendar)).toEqual({
      on: '2026-11-10',
      legs: [tryLeg, sypLeg],
    });
  });

  it('is null when one quote of the cross and the direct bulletin are not of the day', () => {
    const rates = [
      rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-08'),
      rate('USD', 'TRY', '41.0000', 'bulletin', '2026-11-10'),
      rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-08'),
    ];
    expect(policyRate(rates, { ...query, type: 'bulletin' }, calendar)).toBe(null);
    // On Saturday the 14th, P is Thursday the 12th: no row is of it or later.
    expect(policyRate(rates, { ...query, type: 'bulletin', on: '2026-11-14' }, calendar)).toBe(
      null,
    );
  });

  it('prefers the more recent of the direct rate and the cross, the direct rate on a tie', () => {
    // Market rates: a direct rate older than the cross's older quote loses.
    const stale = rate('TRY', 'SYP', '2.8000', 'market', '2026-03-01');
    const tryLeg = rate('USD', 'TRY', '41.2000', 'market', '2026-11-02');
    const sypLeg = rate('USD', 'SYP', '125.0000', 'market', '2026-11-05');
    expect(policyRate([stale, tryLeg, sypLeg], { ...query, type: 'market' }, calendar)).toEqual({
      on: '2026-11-10',
      legs: [tryLeg, sypLeg],
    });
    const tie = rate('TRY', 'SYP', '3.0300', 'market', '2026-11-02');
    expect(policyRate([tie, tryLeg, sypLeg], { ...query, type: 'market' }, calendar)).toBe(tie);
  });

  it('is the direct rate with no `via`, or with `via` one of the pair', () => {
    const direct = rate('TRY', 'SYP', '2.9000', 'bulletin', '2026-11-10');
    const tryLeg = rate('USD', 'TRY', '41.0000', 'bulletin', '2026-11-10');
    const sypLeg = rate('USD', 'SYP', '122.0000', 'bulletin', '2026-11-10');
    const rates = [tryLeg, sypLeg, direct];
    expect(policyRate(rates, { ...query, type: 'bulletin', via: null }, calendar)).toBe(direct);
    expect(policyRate(rates, { ...query, type: 'bulletin', via: 'SYP' }, calendar)).toBe(direct);
    expect(policyRate([tryLeg, sypLeg], { ...query, type: 'bulletin', via: null }, calendar)).toBe(
      null,
    );
  });
});
