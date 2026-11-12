import {
  EVENT_STATES,
  EVENT_TYPES,
  eventTypeHasAmount,
  HUB_CURRENCIES,
  type ReconciliationKind,
} from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayAfter, daysOfMonth } from './periods.js';
import {
  type ComparedEvent,
  compareDay,
  dayState,
  dayTotals,
  gapsOf,
  type HubSideEvent,
  type MizanSideEvent,
  type ReportedEvent,
} from './reconciliation.js';

// Synthetic ids only (AGENTS.md: public repository).
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DATE = '2026-11-04';

const mizanEvent = (n: number, overrides: Partial<MizanSideEvent> = {}): MizanSideEvent => ({
  id: id(n),
  inboxId: id(1000 + n),
  type: 'invoice.issued',
  accountingDate: DATE,
  amount: { currency: 'USD', amount: 50_000n },
  state: 'posted',
  holdReason: null,
  ...overrides,
});

/** Hub's view of an event Mizan holds: what a correct report lists. */
const hubOf = (event: MizanSideEvent): HubSideEvent => ({
  id: event.id,
  type: event.type,
  amount: event.amount,
  delivery: 'delivered',
  refusalCode: null,
});

const kinds = (compared: readonly ComparedEvent[]) =>
  compared.map((event) => [event.eventId, event.kind]);

describe('compareDay (S08 rule 8)', () => {
  it('names every kind for each pairing of the two sides', () => {
    const matched = mizanEvent(1);
    const typeDiffers = mizanEvent(2, { type: 'payment.recorded' });
    const amountDiffers = mizanEvent(3);
    const otherCurrency = mizanEvent(4);
    const notReported = mizanEvent(5);
    const datedLater = mizanEvent(6, { accountingDate: '2026-11-05' });
    const reportedLater = mizanEvent(7);
    const compared = compareDay({
      date: DATE,
      report: [
        hubOf(matched),
        { ...hubOf(typeDiffers), type: 'invoice.issued' },
        { ...hubOf(amountDiffers), amount: { currency: 'USD', amount: 40_000n } },
        { ...hubOf(otherCurrency), amount: { currency: 'SYP', amount: 50_000n } },
        { id: id(8), type: 'invoice.issued', amount: null, delivery: 'refused', refusalCode: 'X' },
        hubOf(datedLater),
      ],
      received: [
        matched,
        typeDiffers,
        amountDiffers,
        otherCurrency,
        notReported,
        datedLater,
        reportedLater,
      ],
      reportedElsewhere: new Map([
        [reportedLater.id, { ...hubOf(reportedLater), accountingDate: '2026-11-03' }],
      ]),
    });
    expect(kinds(compared)).toEqual([
      [id(1), 'matched'],
      [id(2), 'type_differs'],
      [id(3), 'amount_differs'],
      [id(4), 'amount_differs'],
      [id(8), 'missing_in_mizan'],
      [id(6), 'date_differs'],
      [id(5), 'missing_in_hub'],
      [id(7), 'date_differs'],
    ]);
    expect(compared[4]?.hub).toMatchObject({ delivery: 'refused', refusalCode: 'X' });
    expect(compared[7]?.hub?.accountingDate).toBe('2026-11-03');
    expect(gapsOf(compared)).toHaveLength(7);
  });

  it('lists Mizan’s events of the date without a report (pending or missing day)', () => {
    const compared = compareDay({
      date: DATE,
      report: null,
      received: [mizanEvent(1)],
      reportedElsewhere: new Map(),
    });
    expect(kinds(compared)).toEqual([[id(1), 'missing_in_hub']]);
  });

  it('matches an event on the date both agree on and differs on the other (edge case 13)', () => {
    const event = mizanEvent(1);
    const onItsDate = compareDay({
      date: DATE,
      report: [hubOf(event)],
      received: [event],
      reportedElsewhere: new Map(),
    });
    const onTheOther = compareDay({
      date: '2026-11-03',
      report: [hubOf(event)],
      received: [event],
      reportedElsewhere: new Map(),
    });
    expect(kinds(onItsDate)).toEqual([[id(1), 'matched']]);
    expect(kinds(onTheOther)).toEqual([[id(1), 'date_differs']]);
  });

  it('compares a negative amount as it is (edge case 7)', () => {
    const credit = mizanEvent(1, { amount: { currency: 'USD', amount: -13_500n } });
    const compared = compareDay({
      date: DATE,
      report: [hubOf(credit)],
      received: [credit],
      reportedElsewhere: new Map(),
    });
    expect(kinds(compared)).toEqual([[id(1), 'matched']]);
  });
});

const amountArbitrary = fc.record({
  currency: fc.constantFrom(...HUB_CURRENCIES),
  amount: fc.bigInt({ min: -(2n ** 53n) + 1n, max: 2n ** 53n - 1n }),
});

/** Mizan's events of the date: distinct ids, each type's amount by rule 2. */
const receivedArbitrary = fc
  .uniqueArray(
    fc.record({
      n: fc.integer({ min: 1, max: 1_000_000 }),
      type: fc.constantFrom(...EVENT_TYPES),
      amount: amountArbitrary,
      state: fc.constantFrom(...EVENT_STATES),
    }),
    { selector: (event) => event.n, minLength: 1, maxLength: 30 },
  )
  .map((events) =>
    events.map((event) =>
      mizanEvent(event.n, {
        type: event.type,
        amount: eventTypeHasAmount(event.type) ? event.amount : null,
        state: event.state,
      }),
    ),
  );

const compareWith = (
  report: HubSideEvent[] | null,
  received: MizanSideEvent[],
  reportedElsewhere = new Map<string, ReportedEvent>(),
) => compareDay({ date: DATE, report, received, reportedElsewhere });

/** The one gap of a comparison, or a failure naming them all. */
const oneGap = (compared: ComparedEvent[]): [string, ReconciliationKind] => {
  const gaps = gapsOf(compared);
  expect(gaps).toHaveLength(1);
  const [gap] = gaps;
  if (!gap) throw new Error('one gap');
  return [gap.eventId, gap.kind];
};

describe('compareDay’s properties (S08 "Acceptance")', () => {
  it('finds a report built from Mizan’s own events of the date always matched', () => {
    fc.assert(
      fc.property(receivedArbitrary, (received) => {
        const compared = compareWith(received.map(hubOf), received);
        expect(gapsOf(compared)).toEqual([]);
        expect(compared).toHaveLength(received.length);
      }),
    );
  });

  it('finds exactly one gap of the right kind when any one event is removed or changed', () => {
    const change = fc.constantFrom(
      'drop_from_report',
      'drop_from_mizan',
      'change_type',
      'change_amount',
      'change_mizan_date',
      'report_elsewhere',
    );
    fc.assert(
      fc.property(receivedArbitrary, fc.nat(), change, (received, pick, how) => {
        const index = pick % received.length;
        const target = received[index] as MizanSideEvent;
        const report = received.map(hubOf);
        const others = (list: HubSideEvent[]) => list.filter((event) => event.id !== target.id);
        switch (how) {
          case 'drop_from_report':
            expect(oneGap(compareWith(others(report), received))).toEqual([
              target.id,
              'missing_in_hub',
            ]);
            return;
          case 'drop_from_mizan':
            expect(
              oneGap(
                compareWith(
                  report,
                  received.filter((event) => event !== target),
                ),
              ),
            ).toEqual([target.id, 'missing_in_mizan']);
            return;
          case 'change_type': {
            const type = EVENT_TYPES.find(
              (other) =>
                other !== target.type &&
                eventTypeHasAmount(other) === eventTypeHasAmount(target.type),
            );
            if (!type) throw new Error('another type of the same shape');
            const changed = report.map((event) =>
              event.id === target.id ? { ...event, type } : event,
            );
            expect(oneGap(compareWith(changed, received))).toEqual([target.id, 'type_differs']);
            return;
          }
          case 'change_amount': {
            const amount =
              target.amount === null
                ? { currency: 'USD' as const, amount: 1n }
                : { ...target.amount, amount: target.amount.amount + 1n };
            const changed = report.map((event) =>
              event.id === target.id ? { ...event, amount } : event,
            );
            expect(oneGap(compareWith(changed, received))).toEqual([target.id, 'amount_differs']);
            return;
          }
          case 'change_mizan_date': {
            const moved = received.map((event) =>
              event === target ? { ...event, accountingDate: dayAfter(DATE) } : event,
            );
            expect(oneGap(compareWith(report, moved))).toEqual([target.id, 'date_differs']);
            return;
          }
          case 'report_elsewhere': {
            const elsewhere = new Map([
              [target.id, { ...hubOf(target), accountingDate: '2026-11-03' }],
            ]);
            expect(oneGap(compareWith(others(report), received, elsewhere))).toEqual([
              target.id,
              'date_differs',
            ]);
            return;
          }
        }
      }),
    );
  });
});

describe('dayState (S08 rule 10)', () => {
  const base = {
    date: DATE,
    reconcileFrom: '2026-11-01',
    archivedOn: null,
    reported: true,
    gaps: 0,
    now: '2026-11-10T12:00',
  };

  it('is not required before the start date and after the archive day (edge cases 10, 11)', () => {
    expect(dayState({ ...base, reconcileFrom: '2026-11-05' })).toBe('not_required');
    expect(dayState({ ...base, reconcileFrom: DATE })).toBe('matched');
    expect(dayState({ ...base, archivedOn: '2026-11-03' })).toBe('not_required');
    expect(dayState({ ...base, archivedOn: DATE })).toBe('matched');
  });

  it('awaits the report until 08:00 in Damascus the next day, then misses it', () => {
    const unreported = { ...base, reported: false };
    expect(dayState({ ...unreported, now: '2026-11-04T23:59' })).toBe('pending');
    expect(dayState({ ...unreported, now: '2026-11-05T07:59' })).toBe('pending');
    expect(dayState({ ...unreported, now: '2026-11-05T08:00' })).toBe('missing');
    expect(dayState({ ...unreported, now: '2026-11-03T10:00' })).toBe('pending');
  });

  it('has differences while a gap remains, and is matched without', () => {
    expect(dayState({ ...base, gaps: 1 })).toBe('differences');
    expect(dayState(base)).toBe('matched');
  });

  it('counts a leap day and a year end like any day (edge case 15)', () => {
    expect(daysOfMonth('2028-02')).toHaveLength(29);
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    expect(
      dayState({ ...base, date: '2028-02-29', reported: false, now: '2028-03-01T07:00' }),
    ).toBe('pending');
  });
});

describe('dayTotals (S08 rule 11)', () => {
  it('puts Hub’s figures beside Mizan’s per type and currency, never adding currencies', () => {
    const usd = mizanEvent(1);
    const syp = mizanEvent(2, { amount: { currency: 'SYP', amount: 7_000_000n }, state: 'held' });
    const voided = mizanEvent(3, { type: 'invoice.voided', amount: null, state: 'recorded' });
    const totals = dayTotals(
      [hubOf(usd), { ...hubOf(syp), amount: { currency: 'SYP', amount: 6_000_000n } }],
      [usd, syp, voided],
      EVENT_TYPES,
    );
    expect(totals).toEqual([
      {
        type: 'invoice.issued',
        currency: 'SYP',
        hubCount: 1,
        hubAmount: 6_000_000n,
        receivedCount: 1,
        receivedAmount: 7_000_000n,
        states: { held: 1, posted: 0, recorded: 0, resolved: 0, dismissed: 0 },
      },
      {
        type: 'invoice.issued',
        currency: 'USD',
        hubCount: 1,
        hubAmount: 50_000n,
        receivedCount: 1,
        receivedAmount: 50_000n,
        states: { held: 0, posted: 1, recorded: 0, resolved: 0, dismissed: 0 },
      },
      {
        type: 'invoice.voided',
        currency: null,
        hubCount: 0,
        hubAmount: null,
        receivedCount: 1,
        receivedAmount: null,
        states: { held: 0, posted: 0, recorded: 1, resolved: 0, dismissed: 0 },
      },
    ]);
  });
});
