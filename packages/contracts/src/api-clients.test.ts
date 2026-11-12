import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  API_CLIENT_SCOPES,
  API_CLIENT_SYSTEMS,
  API_KEY_PREFIX,
  API_KEY_SECRET_LENGTH,
  allowedNetworkSchema,
  apiClientScopeSchema,
  apiKeySchema,
  ipAllowListSchema,
} from './api-clients.js';

describe('API clients', () => {
  it('publishes the systems and scopes of S05 in order', () => {
    expect(API_CLIENT_SYSTEMS).toEqual(['hub']);
    expect(API_CLIENT_SCOPES).toEqual([
      'events:write',
      'periods:read',
      'reconciliation:write',
      'opening:write',
    ]);
    expect(apiClientScopeSchema.safeParse('events:read').success).toBe(false);
  });

  it('accepts a key of mzn_ and 40 base62 characters only', () => {
    const key = `${API_KEY_PREFIX}${'aZ09'.repeat(10)}`;
    expect(key).toHaveLength(API_KEY_PREFIX.length + API_KEY_SECRET_LENGTH);
    expect(apiKeySchema.safeParse(key).success).toBe(true);
    expect(apiKeySchema.safeParse(`${key}x`).success).toBe(false);
    expect(apiKeySchema.safeParse(key.slice(0, -1)).success).toBe(false);
    expect(apiKeySchema.safeParse(`${key.slice(0, -1)}-`).success).toBe(false);
    expect(apiKeySchema.safeParse(`mzk_${'a'.repeat(40)}`).success).toBe(false);
  });

  it('converts the system and scope schemas to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['ApiClientSystem', 'ApiClientScope']),
    );
  });
});

describe('allowedNetworkSchema', () => {
  it('accepts an address or a network with no host bit, in both families', () => {
    for (const entry of [
      '192.0.2.7',
      '192.0.2.0/24',
      '0.0.0.0/0',
      '10.0.0.0/8',
      '2001:db8::/32',
      '2001:db8::1',
      '::/0',
      '2001:db8:0:0:0:0:0:1/128',
    ]) {
      expect(allowedNetworkSchema.safeParse(entry).success, entry).toBe(true);
    }
  });

  it('refuses host bits after the mask, a mask too long, other text and mapped IPv6', () => {
    for (const entry of [
      '10.0.0.1/8',
      '192.0.2.0/33',
      '2001:db8::1/32',
      '2001:db8::/129',
      '192.0.2.0/24/1',
      '192.0.2.256',
      'example.test',
      '::ffff:192.0.2.1',
      '',
    ]) {
      expect(allowedNetworkSchema.safeParse(entry).success, entry).toBe(false);
    }
    expect(ipAllowListSchema.safeParse(Array(51).fill('192.0.2.1')).success).toBe(false);
  });
});
