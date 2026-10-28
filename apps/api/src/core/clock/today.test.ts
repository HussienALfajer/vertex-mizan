import { describe, expect, it } from 'vitest';
import { todayInDamascus } from './today.js';

describe('todayInDamascus', () => {
  it('turns the day at midnight in Damascus, three hours ahead of UTC', () => {
    expect(todayInDamascus(new Date('2026-11-30T20:59:59Z'))).toBe('2026-11-30');
    expect(todayInDamascus(new Date('2026-11-30T21:00:00Z'))).toBe('2026-12-01');
  });
});
