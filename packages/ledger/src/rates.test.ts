import { describe, expect, it } from 'vitest';
import { policyRate, rateInForce } from './rates.js';
import { rate } from './test-fixtures.js';

describe('rateInForce', () => {
  const table = [
    rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-03'),
    rate('USD', 'SYP', '121.0000', 'bulletin', '2026-11-05'),
    rate('USD', 'SYP', '125.0000', 'market', '2026-11-05'),
    // A correction recorded later for the same date and type.
    rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-05'),
    rate('USD', 'SYP', '123.0000', 'bulletin', '2026-11-20'),
  ];

  it('is the newest row of the type effective on or before the date', () => {
    const on = (date: string) =>
      rateInForce(table, { type: 'bulletin', from: 'USD', to: 'SYP', on: date })?.rate;
    expect(on('2026-11-03')).toBe('120.0000');
    expect(on('2026-11-04')).toBe('120.0000');
    expect(on('2026-11-19')).toBe('121.5000');
    expect(on('2026-11-20')).toBe('123.0000');
    expect(on('2026-12-31')).toBe('123.0000');
  });

  it('takes the row recorded last among rows of the same date', () => {
    expect(rateInForce(table, { type: 'bulletin', from: 'USD', to: 'SYP', on: '2026-11-05' })).toBe(
      table[3],
    );
  });

  it('serves the pair either way round, keeps types apart, and never defaults', () => {
    expect(
      rateInForce(table, { type: 'bulletin', from: 'SYP', to: 'USD', on: '2026-11-04' })?.rate,
    ).toBe('120.0000');
    expect(
      rateInForce(table, { type: 'market', from: 'USD', to: 'SYP', on: '2026-11-20' })?.rate,
    ).toBe('125.0000');
    expect(rateInForce(table, { type: 'market', from: 'USD', to: 'SYP', on: '2026-11-04' })).toBe(
      null,
    );
    expect(rateInForce(table, { type: 'bulletin', from: 'USD', to: 'SYP', on: '2026-11-02' })).toBe(
      null,
    );
    expect(rateInForce(table, { type: 'bulletin', from: 'EUR', to: 'SYP', on: '2026-11-20' })).toBe(
      null,
    );
  });
});

describe('policyRate', () => {
  const weeklyTry = rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-02');
  const dailyUsd = rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-05');
  const tryUsd = rate('TRY', 'USD', '0.0240', 'bulletin', '2026-11-02');

  it('prefers the more recent of the direct rate and the cross, the direct rate on a tie', () => {
    // A direct rate of 2026-03-01 is older than the cross's older quote (2026-11-02).
    const stale = rate('TRY', 'USD', '0.0300', 'bulletin', '2026-03-01');
    expect(
      policyRate([stale, weeklyTry, dailyUsd], {
        type: 'bulletin',
        from: 'TRY',
        to: 'USD',
        on: '2026-11-05',
        via: 'SYP',
      }),
    ).toEqual({ on: '2026-11-05', legs: [weeklyTry, dailyUsd] });
  });

  it('is the direct rate when it is as recent as the cross', () => {
    expect(
      policyRate([weeklyTry, dailyUsd, tryUsd], {
        type: 'bulletin',
        from: 'TRY',
        to: 'USD',
        on: '2026-11-05',
        via: 'SYP',
      }),
    ).toBe(tryUsd);
  });

  it('crosses through `via` with the quotes in force on the entry date', () => {
    // A weekly TRY bulletin of 2026-11-02 and a daily USD bulletin of 2026-11-05.
    expect(
      policyRate([weeklyTry, dailyUsd], {
        type: 'bulletin',
        from: 'TRY',
        to: 'USD',
        on: '2026-11-05',
        via: 'SYP',
      }),
    ).toEqual({ on: '2026-11-05', legs: [weeklyTry, dailyUsd] });
  });

  it('is null when a leg is missing, there is no `via`, or `via` is one of the pair', () => {
    const query = { type: 'bulletin', from: 'TRY', to: 'USD', on: '2026-11-04' } as const;
    // The daily USD bulletin is not in force yet on 2026-11-04.
    expect(policyRate([weeklyTry, dailyUsd], { ...query, via: 'SYP' })).toBe(null);
    expect(policyRate([weeklyTry, dailyUsd], { ...query, on: '2026-11-05', via: null })).toBe(null);
    expect(policyRate([weeklyTry, dailyUsd], { ...query, on: '2026-11-05', via: 'USD' })).toBe(
      null,
    );
  });
});
