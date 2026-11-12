import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, eventEnvelopeSchema } from './events.js';
import { eventExamplesV1, reconciliationExampleV1 } from './hub-examples.js';

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
