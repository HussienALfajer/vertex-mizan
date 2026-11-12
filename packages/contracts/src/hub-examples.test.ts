import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, eventEnvelopeSchema } from './events.js';
import {
  eventExamplesV1,
  openingSnapshotExampleV1,
  openingSnapshotKeyV1,
  reconciliationExampleV1,
} from './hub-examples.js';
import { openingSnapshotSchema, openingSnapshotTotals } from './opening.js';

describe('eventExamplesV1', () => {
  it('has every event type of the catalogue once, each valid', () => {
    const examples = eventExamplesV1('2026-11-02');
    expect([...examples.map((example) => example.type)].sort()).toEqual([...EVENT_TYPES].sort());
    for (const example of examples) {
      const parsed = eventEnvelopeSchema.safeParse(example);
      expect(parsed.success, `${example.type}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(new Set(examples.map((example) => example.id)).size).toBe(examples.length);
  });

  it('is the same on every run for a date', () => {
    expect(eventExamplesV1('2026-11-02')).toEqual(eventExamplesV1('2026-11-02'));
  });
});

describe('reconciliationExampleV1 (S08 rule 1)', () => {
  it('lists every example of its date once, with its totals, the same on every run', () => {
    const report = reconciliationExampleV1('2026-11-03');
    const examples = eventExamplesV1('2026-11-03');
    expect(report.events.map((event) => event.id)).toEqual(examples.map((example) => example.id));
    expect(report.events.every((event) => event.delivery === 'delivered')).toBe(true);
    expect(report.totals.find((total) => total.type === 'invoice.issued')).toEqual({
      type: 'invoice.issued',
      currency: 'USD',
      count: 1,
      amount: 50_000,
    });
    expect(reconciliationExampleV1('2026-11-03')).toEqual(report);
    expect(reconciliationExampleV1('2026-11-04').id).not.toBe(report.id);
  });
});

describe('openingSnapshotExampleV1 (S10 rule 5)', () => {
  it("is S10's worked example as of the eve, valid and the same on every run", () => {
    const snapshot = openingSnapshotExampleV1('2026-10-01');
    expect(openingSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.as_of).toBe('2026-09-30');
    const [invoice] = snapshot.invoices;
    expect(invoice?.issued_on).toBe('2026-09-10');
    expect(invoice?.lines[0]).toMatchObject({ cycle_start: '2026-09-16', cycle_end: '2026-10-15' });
    expect(openingSnapshotTotals(snapshot).totals).toEqual(
      expect.arrayContaining([
        { list: 'invoices', currency: 'USD', amount: 30_000 },
        { list: 'wallets', currency: 'USD', amount: 50_000 },
      ]),
    );
    expect(openingSnapshotExampleV1('2026-10-01')).toEqual(snapshot);
    expect(openingSnapshotKeyV1('2026-10-01')).toBe(openingSnapshotKeyV1('2026-10-01'));
  });

  it('crosses a year end', () => {
    expect(openingSnapshotExampleV1('2027-01-01').as_of).toBe('2026-12-31');
  });
});
