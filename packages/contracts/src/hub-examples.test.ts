import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, eventEnvelopeSchema } from './events.js';
import { eventExamplesV1 } from './hub-examples.js';

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
