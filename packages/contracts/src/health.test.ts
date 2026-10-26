import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  const healthy = {
    status: 'ok',
    checks: { database: 'up' },
    timestamp: '2026-10-26T10:00:00.000Z',
  };

  it('accepts a healthy and an unhealthy answer', () => {
    expect(healthResponseSchema.parse(healthy)).toEqual(healthy);
    const down = { ...healthy, status: 'error', checks: { database: 'down' } };
    expect(healthResponseSchema.parse(down)).toEqual(down);
  });

  it('refuses an unknown status or a missing check', () => {
    expect(healthResponseSchema.safeParse({ ...healthy, status: 'degraded' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...healthy, checks: {} }).success).toBe(false);
  });

  it('is published under its id', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, { unrepresentable: 'throw' });
    expect(schemas.HealthResponse).toMatchObject({
      type: 'object',
      required: ['status', 'checks', 'timestamp'],
    });
  });
});
