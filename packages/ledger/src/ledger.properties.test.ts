import {
  type CompanyLedgers,
  CURRENCY_CODES,
  type CurrencyCode,
  type ExchangeRate,
  type Ledger,
  money,
  type RatePolicy,
} from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, allocateCarried } from './allocation.js';
import { balanceEntry, exchangeDifferenceLines, ledgerTotal } from './balance.js';
import { clearOpenItem, moveRunningBalance, openItemCarrying, reverseLines } from './carried.js';
import {
  type CanonicalValue,
  type ChainLink,
  canonicalJson,
  entryHash,
  verifyChain,
} from './integrity.js';
import {
  type CarriedAmounts,
  carriedLine,
  keptLedgers,
  type Line,
  ledgerAmount,
  ledgerCurrency,
} from './lines.js';
import { manualEntryLines } from './manual.js';
import { type MeasureContext, measuredLine } from './measure.js';
import { lastPublicationDay, type PublicationCalendar, rateInForce } from './rates.js';
import { calendar, refusal } from './test-fixtures.js';

/**
 * The ADR 0007 properties of the ledger mechanics, the bulletin rate of the day's (ADR 0011, S02
 * rule 16) and the integrity chain's (ADR 0005). The
 * inverse property of a conversion is a property of `convert()`, tested in `packages/contracts`.
 * Expected values are computed here from the generated inputs, not by the code under test.
 */

const abs = (value: bigint) => (value < 0n ? -value : value);
/** round(n ÷ d) half away from zero, written out here for the expected values. */
function round(n: bigint, d: bigint): bigint {
  const [numerator, denominator] = d < 0n ? [-n, -d] : [n, d];
  const quotient = numerator / denominator;
  const twice = abs(numerator % denominator) * 2n;
  if (twice < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

const currency = fc.constantFrom(...CURRENCY_CODES);
const policy = fc.constantFrom<RatePolicy>(
  { rateType: 'bulletin', acceptsTransactionRate: false },
  { rateType: 'market', acceptsTransactionRate: false },
  { rateType: 'market', acceptsTransactionRate: true },
);
const ledgers: fc.Arbitrary<CompanyLedgers> = fc
  .tuple(currency, fc.option(currency, { nil: null }), policy, policy)
  .filter(([book, parallel]) => parallel !== book)
  .map(([book, parallel, bookPolicy, parallelPolicy]) => ({
    book: { currency: book, ratePolicy: bookPolicy },
    parallel: parallel === null ? null : { currency: parallel, ratePolicy: parallelPolicy },
  }));

/** A rate of 0.0001 to 9 999.9999, four places, as quoted. */
const rateValue = fc.bigInt({ min: 1n, max: 10n ** 8n - 1n }).map((units) => {
  const digits = units.toString().padStart(5, '0');
  return `${digits.slice(0, -4).replace(/^0+(?=\d)/, '')}.${digits.slice(-4)}`;
});
const amount = fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n });
const nonZero = amount.filter((value) => value !== 0n);

function row(base: CurrencyCode, quote: CurrencyCode, value: string, type: ExchangeRate['type']) {
  // Dated the entry date, so a bulletin row is the day's own (ADR 0011).
  return { effectiveOn: '2026-11-15', base, quote, rate: value, type, source: 'manual' } as const;
}

/** How each ledger gets its rate for `from`: a direct quote either way round, or a cross. */
const rateChoices = fc.array(
  fc.record({ cross: fc.boolean(), flip: fc.boolean(), first: rateValue, second: rateValue }),
  {
    minLength: 2,
    maxLength: 2,
  },
);

/** A rate table giving every kept ledger a rate of its policy type for `from`. */
function rateTable(
  company: CompanyLedgers,
  from: CurrencyCode,
  choices: readonly { cross: boolean; flip: boolean; first: string; second: string }[],
): ExchangeRate[] {
  const rates: ExchangeRate[] = [];
  for (const [index, [ledger, settings]] of keptLedgers(company).entries()) {
    const to = settings.currency;
    const choice = choices[index];
    if (to === from || choice === undefined) continue;
    const type = settings.ratePolicy.rateType;
    const via = ledger === 'book' ? (company.parallel?.currency ?? null) : company.book.currency;
    if (choice.cross && via !== null && via !== from) {
      rates.push(
        choice.flip ? row(via, from, choice.first, type) : row(from, via, choice.first, type),
      );
      rates.push(row(via, to, choice.second, type));
    } else {
      rates.push(
        choice.flip ? row(to, from, choice.first, type) : row(from, to, choice.first, type),
      );
    }
  }
  return rates;
}

/** An entry of new measurements in one currency: a debit and the credits it is split into. */
const newMeasurements = fc
  .record({
    company: ledgers,
    from: currency,
    choices: rateChoices,
    credits: fc.array(amount, { minLength: 1, maxLength: 6 }),
    ownRate: fc.option(rateValue, { nil: null }),
  })
  .map(({ company, from, choices, credits, ownRate }) => {
    const parallel = company.parallel?.currency;
    const context: MeasureContext = {
      ledgers: company,
      on: '2026-11-15',
      calendar,
      rates: rateTable(company, from, choices),
      ...(ownRate !== null && parallel !== undefined && parallel !== from
        ? { transactionRate: { ...row(from, parallel, ownRate, 'market'), source: 'hub' } }
        : {}),
    };
    const total = credits.reduce((sum, credit) => sum + credit, 0n);
    const lines = [
      measuredLine({ account: 'D', amount: money(total, from) }, context),
      ...credits.map((credit) =>
        measuredLine({ account: 'C', amount: money(-credit, from) }, context),
      ),
    ];
    return { company, lines, context, from };
  });

const rounding = { account: 'R' };

function converted(lines: readonly Line[], ledger: Ledger): number {
  return lines.filter((line) => line.kind === 'measured' && line.conversions[ledger] !== null)
    .length;
}

/** A day of November and December 2026 (`offset` days after 1 November), as `YYYY-MM-DD`. */
const day = (offset: number) => new Date(Date.UTC(2026, 10, 1 + offset)).toISOString().slice(0, 10);
const offset = fc.integer({ min: 0, max: 60 });

/** A USD–SYP rate table of both types, in recording order, either orientation per row. */
const rateRows = fc
  .array(
    fc.record({
      on: offset,
      value: rateValue,
      type: fc.constantFrom('bulletin', 'market') as fc.Arbitrary<ExchangeRate['type']>,
      flip: fc.boolean(),
    }),
    { maxLength: 12 },
  )
  .map((rows) =>
    rows.map(
      ({ on, value, type, flip }): ExchangeRate => ({
        effectiveOn: day(on),
        base: flip ? 'SYP' : 'USD',
        quote: flip ? 'USD' : 'SYP',
        rate: value,
        type,
        source: 'manual',
      }),
    ),
  );

const publicationCalendar: fc.Arbitrary<PublicationCalendar> = fc.record({
  daysOff: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { maxLength: 7 }),
  holidays: fc.uniqueArray(offset.map(day), { maxLength: 10 }),
});

const lookup = (
  rates: readonly ExchangeRate[],
  type: ExchangeRate['type'],
  on: string,
  at: PublicationCalendar,
) => rateInForce(rates, { type, from: 'USD', to: 'SYP', on }, at);

/** ADR 0007's lookup, written out: the newest row on or before the date, the last recorded on a tie. */
function newestOnOrBefore(rates: readonly ExchangeRate[], type: ExchangeRate['type'], on: string) {
  let found: ExchangeRate | null = null;
  for (const rate of rates) {
    if (rate.type !== type || rate.effectiveOn > on) continue;
    if (found === null || rate.effectiveOn >= found.effectiveOn) found = rate;
  }
  return found;
}

describe('the bulletin rate of the day', () => {
  it('leaves a market lookup unchanged: the newest row on or before the date, any calendar', () => {
    fc.assert(
      fc.property(rateRows, offset, publicationCalendar, (rates, on, at) => {
        expect(lookup(rates, 'market', day(on), at)).toBe(
          newestOnOrBefore(rates, 'market', day(on)),
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('on a publication day returns only a row of that day', () => {
    fc.assert(
      fc.property(rateRows, offset, publicationCalendar, (rates, on, at) => {
        fc.pre(lastPublicationDay(day(on), at) === day(on));
        const found = lookup(rates, 'bulletin', day(on), at);
        expect(found === null || found.effectiveOn === day(on)).toBe(true);
        expect(found).toBe(
          rates.some((rate) => rate.type === 'bulletin' && rate.effectiveOn === day(on))
            ? newestOnOrBefore(rates, 'bulletin', day(on))
            : null,
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('on a day off equals the lookup on the last publication day, unless a later row exists', () => {
    fc.assert(
      fc.property(rateRows, offset, publicationCalendar, (rates, on, at) => {
        const published = lastPublicationDay(day(on), at);
        if (published === null) {
          expect(lookup(rates, 'bulletin', day(on), at)).toBe(null);
          return;
        }
        const later = rates.some(
          (rate) =>
            rate.type === 'bulletin' && rate.effectiveOn > published && rate.effectiveOn <= day(on),
        );
        fc.pre(!later);
        expect(lookup(rates, 'bulletin', day(on), at)).toBe(
          lookup(rates, 'bulletin', published, at),
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('never makes a found bulletin missing when a holiday is added', () => {
    fc.assert(
      fc.property(rateRows, offset, publicationCalendar, offset, (rates, on, at, holiday) => {
        const found = lookup(rates, 'bulletin', day(on), at);
        fc.pre(found !== null);
        const more = { ...at, holidays: [...new Set([...at.holidays, day(holiday)])] };
        expect(lookup(rates, 'bulletin', day(on), more)).not.toBe(null);
      }),
      { numRuns: 1_000 },
    );
  });

  it('finds the latest publication day on or before the date, with none between', () => {
    fc.assert(
      fc.property(offset, publicationCalendar, (on, at) => {
        const published = lastPublicationDay(day(on), at);
        const isPublication = (date: string) =>
          !at.daysOff.includes(((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) &&
          !at.holidays.includes(date);
        if (at.daysOff.length === 7) {
          expect(published).toBe(null);
          return;
        }
        expect(published).not.toBe(null);
        expect(published !== null && published <= day(on) && isPublication(published)).toBe(true);
        for (let back = on; day(back) > (published ?? ''); back -= 1) {
          expect(isPublication(day(back))).toBe(false);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('built entries', () => {
  it('balance in every ledger, each rounding line within half a minor unit per converted line', () => {
    fc.assert(
      fc.property(newMeasurements, ({ company, lines }) => {
        const entry = balanceEntry({ on: '2026-11-15', ledgers: company, lines, rounding });
        for (const [ledger] of keptLedgers(company)) {
          expect(ledgerTotal(entry, ledger)).toBe(0n);
          const roundingLines = entry.filter(
            (line) => line.kind === 'rounding' && line.ledger === ledger,
          );
          expect(roundingLines.length).toBeLessThanOrEqual(1);
          for (const line of roundingLines) {
            const amountMinor = ledgerAmount(line, ledger) ?? 0n;
            expect(2n * abs(amountMinor) <= BigInt(converted(lines, ledger))).toBe(true);
          }
        }
        // A rounding line has an amount in its own ledger only.
        for (const line of entry.filter((line) => line.kind === 'rounding')) {
          const other: Ledger =
            line.kind === 'rounding' && line.ledger === 'book' ? 'parallel' : 'book';
          expect(ledgerAmount(line, other) ?? 0n).toBe(0n);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('reverse to lines that negate every amount and net every account to zero', () => {
    fc.assert(
      fc.property(newMeasurements, ({ company, lines }) => {
        const entry = balanceEntry({ on: '2026-11-15', ledgers: company, lines, rounding });
        const reversal = reverseLines(entry);
        // The reversal balances as it is: no new rounding line.
        expect(
          balanceEntry({ on: '2026-11-20', ledgers: company, lines: reversal, rounding }),
        ).toEqual(reversal);
        for (const [index, line] of reversal.entries()) {
          const original = entry[index] as Line;
          expect(line.transaction.amountMinor).toBe(-original.transaction.amountMinor);
          expect(line.bookMinor).toBe(-original.bookMinor);
          expect(line.parallelMinor).toBe(
            original.parallelMinor === null ? null : -original.parallelMinor,
          );
        }
        const both = [...entry, ...reversal];
        for (const account of new Set(both.map((line) => line.account))) {
          const lines = both.filter((line) => line.account === account);
          for (const [ledger] of keptLedgers(company)) expect(ledgerTotal(lines, ledger)).toBe(0n);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('imbalances', () => {
  it('in the one currency of an entry are refused, with or without difference lines', () => {
    fc.assert(
      fc.property(newMeasurements, nonZero, ({ company, lines, context, from }, offset) => {
        const off = [
          ...lines,
          measuredLine({ account: 'D', amount: money(offset, from) }, context),
        ];
        expect(refusal(() => exchangeDifferenceLines(company, off, { account: 'X' }))).toBe(
          'ENTRY_UNBALANCED',
        );
        expect(
          refusal(() => balanceEntry({ on: '2026-11-15', ledgers: company, lines: off, rounding })),
        ).toBe('ENTRY_UNBALANCED');
      }),
      { numRuns: 500 },
    );
  });

  it('are never absorbed by a rounding line passed in', () => {
    fc.assert(
      fc.property(newMeasurements, nonZero, fc.boolean(), ({ company, lines }, extra, inBook) => {
        const entry = balanceEntry({ on: '2026-11-15', ledgers: company, lines, rounding });
        const ledger: Ledger = inBook || company.parallel === null ? 'book' : 'parallel';
        const roundingLine: Line = {
          kind: 'rounding',
          ledger,
          account: 'R',
          dimensions: {},
          transaction: money(extra, ledgerCurrency(company, ledger)),
          bookMinor: ledger === 'book' ? extra : 0n,
          parallelMinor: company.parallel === null ? null : ledger === 'parallel' ? extra : 0n,
        };
        expect(
          refusal(() =>
            balanceEntry({
              on: '2026-11-15',
              ledgers: company,
              lines: [...entry, roundingLine],
              rounding,
            }),
          ),
        ).toBe('ENTRY_UNBALANCED');
      }),
      { numRuns: 500 },
    );
  });
});

describe('settlements', () => {
  it('balance with difference lines that each carry an amount in one ledger only', () => {
    fc.assert(
      fc.property(
        ledgers,
        currency,
        rateChoices,
        rateChoices,
        nonZero,
        fc.bigInt({ min: 1n, max: 100n }),
        (company, from, issued, settled, total, percent) => {
          const at = (on: string, choices: typeof issued): MeasureContext => ({
            ledgers: company,
            on,
            calendar,
            rates: rateTable(company, from, choices).map((rate) => ({ ...rate, effectiveOn: on })),
          });
          const item = measuredLine(
            { account: 'I', amount: money(total, from) },
            at('2026-11-03', issued),
          );
          const paid = (total * percent) / 100n;
          const lines = [
            measuredLine({ account: 'P', amount: money(paid, from) }, at('2026-11-20', settled)),
            carriedLine({
              account: 'I',
              amounts: clearOpenItem({ measured: item, openMinor: total }, -paid),
            }),
          ];
          // Paying more than is open is not an exchange difference: the excess needs its own line.
          const overpaid = [
            measuredLine(
              { account: 'P', amount: money(paid + (total < 0n ? -1n : 1n), from) },
              at('2026-11-20', settled),
            ),
            ...lines.slice(1),
          ];
          expect(refusal(() => exchangeDifferenceLines(company, overpaid, { account: 'X' }))).toBe(
            'ENTRY_UNBALANCED',
          );
          const differences = exchangeDifferenceLines(company, lines, { account: 'X' });
          const entry = balanceEntry({
            on: '2026-11-20',
            ledgers: company,
            lines: [...lines, ...differences],
            rounding,
          });
          expect(entry).toHaveLength(lines.length + differences.length);
          for (const line of differences) {
            if (line.kind !== 'difference') throw new TypeError('Not a difference line');
            const other: Ledger = line.ledger === 'book' ? 'parallel' : 'book';
            expect(ledgerAmount(line, other) ?? 0n).toBe(0n);
            expect(line.transaction.amountMinor).toBe(ledgerAmount(line, line.ledger));
          }
          for (const [ledger] of keptLedgers(company)) expect(ledgerTotal(entry, ledger)).toBe(0n);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

/** A manual entry in two currencies (a currency purchase or sale), with or without a dealt rate. */
const exchange = fc
  .record({
    company: ledgers,
    pair: fc.uniqueArray(currency, { minLength: 2, maxLength: 2 }),
    choices: fc.tuple(rateChoices, rateChoices),
    given: nonZero,
    received: nonZero,
    dealt: fc.option(
      fc.record({
        line: fc.boolean(),
        parallel: fc.boolean(),
        flip: fc.boolean(),
        value: rateValue,
        // A pair the accountant may give that no line and ledger currency make up.
        stray: fc.option(fc.uniqueArray(currency, { minLength: 2, maxLength: 2 }), { nil: null }),
      }),
      { nil: null },
    ),
  })
  .map(({ company, pair, choices, given, received, dealt }) => {
    const [from, to] = pair as [CurrencyCode, CurrencyCode];
    const context: MeasureContext = {
      ledgers: company,
      on: '2026-11-15',
      calendar,
      rates: [...rateTable(company, from, choices[0]), ...rateTable(company, to, choices[1])],
    };
    const dealtRates: ExchangeRate[] = [];
    if (dealt?.stray) {
      const [base, quote] = dealt.stray as [CurrencyCode, CurrencyCode];
      dealtRates.push(row(base, quote, dealt.value, 'market'));
    } else if (dealt !== null) {
      const ledger = dealt.parallel && company.parallel !== null ? company.parallel : company.book;
      const of = dealt.line ? from : to;
      if (of !== ledger.currency) {
        dealtRates.push(
          dealt.flip
            ? row(ledger.currency, of, dealt.value, 'market')
            : row(of, ledger.currency, dealt.value, 'market'),
        );
      }
    }
    const lines = [
      { account: 'A', amount: money(received, to) },
      { account: 'B', amount: money(-given, from) },
    ];
    return { company, context, entry: { lines, dealtRates }, currencies: [from, to] };
  });

const realised = { gain: { account: 'G' }, loss: { account: 'L' } };

/** Whether a ledger of `company` can use `dealt` for a line in one of `currencies`. */
function dealtAccepted(
  company: CompanyLedgers,
  currencies: readonly CurrencyCode[],
  dealt: ExchangeRate,
): boolean {
  return keptLedgers(company).some(
    ([, settings]) =>
      settings.ratePolicy.rateType === 'market' &&
      settings.ratePolicy.acceptsTransactionRate &&
      currencies.some(
        (other) =>
          other !== settings.currency &&
          [dealt.base, dealt.quote].includes(other) &&
          [dealt.base, dealt.quote].includes(settings.currency),
      ),
  );
}

describe('manual entries in two currencies', () => {
  it('balance with one realised difference per ledger, a debit to the loss and a credit to the gain', () => {
    fc.assert(
      fc.property(exchange, ({ company, context, entry, currencies }) => {
        const [dealt] = entry.dealtRates;
        if (dealt !== undefined && !dealtAccepted(company, currencies, dealt)) {
          expect(refusal(() => manualEntryLines(entry, context, realised))).toBe(
            'DEALT_RATE_NOT_ACCEPTED',
          );
          return;
        }
        const lines = manualEntryLines(entry, context, realised);
        // The differences absorb all of each ledger's residual: no rounding line is added.
        expect(balanceEntry({ on: '2026-11-15', ledgers: company, lines, rounding })).toEqual(
          lines,
        );
        for (const [ledger] of keptLedgers(company)) {
          expect(ledgerTotal(lines, ledger)).toBe(0n);
          const differences = lines.filter(
            (line) => line.kind === 'difference' && line.ledger === ledger,
          );
          expect(differences.length).toBeLessThanOrEqual(1);
          for (const line of differences) {
            const amountMinor = ledgerAmount(line, ledger) ?? 0n;
            expect(line.account).toBe(amountMinor > 0n ? 'L' : 'G');
            expect(line.transaction).toEqual(money(amountMinor, ledgerCurrency(company, ledger)));
            const other: Ledger = ledger === 'book' ? 'parallel' : 'book';
            expect(ledgerAmount(line, other) ?? 0n).toBe(0n);
          }
        }
        // A ledger that accepts the dealt rate converts its pair at it, and only that pair.
        for (const line of lines) {
          if (line.kind !== 'measured') continue;
          for (const [ledger, settings] of keptLedgers(company)) {
            const conversion = line.conversions[ledger];
            const pair = [line.transaction.currency, settings.currency];
            const takes =
              dealt !== undefined &&
              settings.ratePolicy.rateType === 'market' &&
              settings.ratePolicy.acceptsTransactionRate &&
              line.transaction.currency !== settings.currency &&
              pair.includes(dealt.base) &&
              pair.includes(dealt.quote);
            expect(conversion?.basis === 'transaction').toBe(takes);
            if (takes) expect(conversion?.rate).toEqual(dealt);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('reverse to lines that balance as they are and net every account to zero', () => {
    fc.assert(
      fc.property(exchange, ({ company, context, entry, currencies }) => {
        const [dealt] = entry.dealtRates;
        if (dealt !== undefined && !dealtAccepted(company, currencies, dealt)) return;
        const lines = manualEntryLines(entry, context, realised);
        const reversal = reverseLines(lines);
        expect(
          balanceEntry({ on: '2026-12-01', ledgers: company, lines: reversal, rounding }),
        ).toEqual(reversal);
        const both = [...lines, ...reversal];
        for (const account of new Set(both.map((line) => line.account))) {
          const ofAccount = both.filter((line) => line.account === account);
          for (const [ledger] of keptLedgers(company)) {
            expect(ledgerTotal(ofAccount, ledger)).toBe(0n);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

/** Carried amounts in one currency; a ledger in that currency carries the transaction amount. */
const carried = fc
  .record({
    total: nonZero,
    book: amount,
    parallel: fc.option(amount, { nil: null }),
    bookIsOwn: fc.boolean(),
  })
  .map(({ total, book, parallel, bookIsOwn }) => ({
    transaction: money(total, 'USD'),
    bookMinor: bookIsOwn ? total : book,
    parallelMinor: parallel,
  }));

/** Cut points splitting a transaction amount into consecutive parts that reach it exactly. */
function parts(total: bigint, cuts: readonly bigint[]): bigint[] {
  const magnitude = abs(total);
  const points = [...new Set(cuts.map((cut) => cut % magnitude))].sort((a, b) => (a < b ? -1 : 1));
  const sign = total < 0n ? -1n : 1n;
  const bounds = [0n, ...points.filter((point) => point > 0n), magnitude];
  return bounds.slice(1).map((bound, index) => sign * (bound - (bounds[index] as bigint)));
}

describe('carried balances', () => {
  it('clear in parts that come from the carried amounts alone and leave zero in every ledger', () => {
    fc.assert(
      fc.property(
        carried,
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { maxLength: 5 }),
        (item, cuts) => {
          const total = item.transaction.amountMinor;
          let open = total;
          let cleared = 0n;
          const sum = { transaction: 0n, book: 0n, parallel: 0n };
          for (const part of parts(total, cuts)) {
            const line = clearOpenItem({ measured: item, openMinor: open }, -part);
            open -= part;
            cleared += part;
            sum.transaction += line.transaction.amountMinor;
            sum.book += line.bookMinor;
            sum.parallel += line.parallelMinor ?? 0n;
            // Never converted again: what is cleared so far is the carried amount in proportion.
            expect(-sum.book).toBe(round(item.bookMinor * cleared, total));
            if (item.parallelMinor !== null)
              expect(-sum.parallel).toBe(round(item.parallelMinor * cleared, total));
            // A ledger in the item's currency clears the transaction amount itself.
            if (item.bookMinor === total) expect(line.bookMinor).toBe(line.transaction.amountMinor);
          }
          expect([sum.transaction, sum.book]).toEqual([-total, -item.bookMinor]);
          expect(openItemCarrying({ measured: item, openMinor: 0n })).toEqual({
            transaction: money(0n, 'USD'),
            bookMinor: 0n,
            parallelMinor: item.parallelMinor === null ? null : 0n,
          });
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it('kept as a running balance are zero in every ledger whenever the transaction balance is', () => {
    const movement = fc.record({
      amount: nonZero,
      bookRate: fc.bigInt({ min: 0n, max: 200n }),
      parallelRate: fc.bigInt({ min: 0n, max: 200n }),
    });
    fc.assert(
      fc.property(fc.array(movement, { maxLength: 12 }), (movements) => {
        let balance: CarriedAmounts = {
          transaction: money(0n, 'USD'),
          bookMinor: 0n,
          parallelMinor: 0n,
        };
        for (const { amount: moved, bookRate, parallelRate } of movements) {
          const before = balance.transaction.amountMinor;
          const { cleared, measuredMinor } = moveRunningBalance(balance, moved);
          if (cleared !== null) {
            expect(abs(cleared.transaction.amountMinor) <= abs(before)).toBe(true);
            // At the average carrying amount of the balance before it.
            if (cleared.transaction.amountMinor !== -before) {
              expect(cleared.bookMinor).toBe(round(balance.bookMinor * moved, before));
            }
          }
          const next = (field: 'book' | 'parallel', measured: bigint) => {
            const current = field === 'book' ? balance.bookMinor : (balance.parallelMinor ?? 0n);
            const clearedPart =
              cleared === null
                ? 0n
                : field === 'book'
                  ? cleared.bookMinor
                  : (cleared.parallelMinor ?? 0n);
            return current + clearedPart + measured;
          };
          balance = {
            transaction: money(
              before + (cleared?.transaction.amountMinor ?? 0n) + measuredMinor,
              'USD',
            ),
            // The part measured new, at the movement's own (generated) rates.
            bookMinor: next('book', measuredMinor * bookRate),
            parallelMinor: next('parallel', measuredMinor * parallelRate),
          };
          expect(balance.transaction.amountMinor).toBe(before + moved);
          if (balance.transaction.amountMinor === 0n) {
            expect([balance.bookMinor, balance.parallelMinor]).toEqual([0n, 0n]);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('allocations', () => {
  const weights = fc
    .array(fc.bigInt({ min: 0n, max: 10_000n }), { minLength: 1, maxLength: 12 })
    .filter((list) => list.some((weight) => weight > 0n));

  it('sum exactly, each prefix rounded once, so a recomputation never changes a posted part', () => {
    fc.assert(
      fc.property(amount, weights, (total, list) => {
        const allocated = allocate(total, list);
        const whole = list.reduce((sum, weight) => sum + weight, 0n);
        let cumulative = 0n;
        let prefix = 0n;
        for (const [index, part] of allocated.entries()) {
          cumulative += list[index] as bigint;
          prefix += part;
          expect(prefix).toBe(round(total * cumulative, whole));
        }
        expect(prefix).toBe(total);
        expect(allocate(-total, list)).toEqual(allocated.map((part) => -part));
      }),
      { numRuns: 1_000 },
    );
  });

  it('split a carried balance in every ledger separately, summing to it exactly', () => {
    fc.assert(
      fc.property(carried, weights, (balance, list) => {
        const split = allocateCarried(balance, list);
        expect(split.map((part) => part.transaction.amountMinor)).toEqual(
          allocate(balance.transaction.amountMinor, list),
        );
        expect(split.map((part) => part.bookMinor)).toEqual(allocate(balance.bookMinor, list));
        expect(split.map((part) => part.parallelMinor)).toEqual(
          balance.parallelMinor === null
            ? list.map(() => null)
            : allocate(balance.parallelMinor, list),
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('the integrity chain', () => {
  const { value: canonical } = fc.letrec<{ value: CanonicalValue }>((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.string(),
      fc.bigInt(),
      fc.integer(),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(fc.string(), tie('value'), { maxKeys: 4 }),
    ),
  }));

  /** The same value with every object's keys inserted in reverse order. */
  function reversedKeys(value: CanonicalValue): CanonicalValue {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(reversedKeys);
    const record = value as { readonly [key: string]: CanonicalValue };
    return Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, reversedKeys(record[key] ?? null)]),
    );
  }

  it('serialises a value one way, whatever the order of its keys', () => {
    fc.assert(
      fc.property(canonical, (value) => {
        expect(canonicalJson(reversedKeys(value))).toBe(canonicalJson(value));
      }),
      { numRuns: 500 },
    );
  });

  it('verifies after any sequence of postings and breaks at the first altered entry', () => {
    fc.assert(
      fc.property(
        fc.array(canonical, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        canonical,
        (entries, at, other) => {
          const links: ChainLink[] = [];
          let previousHash: string | null = null;
          for (const entry of entries) {
            const hash = entryHash(entry, previousHash);
            links.push({ entry, previousHash, hash });
            previousHash = hash;
          }
          expect(verifyChain(links)).toBe(null);
          const index = at % links.length;
          const target = links[index] as ChainLink;
          fc.pre(canonicalJson(other) !== canonicalJson(target.entry));
          const altered = links.map((link, position) =>
            position === index ? { ...link, entry: other } : link,
          );
          expect(verifyChain(altered)).toEqual({ index, reason: 'hash' });
        },
      ),
      { numRuns: 300 },
    );
  });
});
