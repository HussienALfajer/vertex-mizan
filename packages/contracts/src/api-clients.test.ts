import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  API_CLIENT_SCOPES,
  API_CLIENT_SYSTEMS,
  API_KEY_PREFIX,
  API_KEY_SECRET_LENGTH,
  apiClientScopeSchema,
  apiKeySchema,
} from './api-clients.js';

describe('API clients', () => {
  it('publishes the systems and scopes of S05 in order', () => {
    expect(API_CLIENT_SYSTEMS).toEqual(['hub']);
    expect(API_CLIENT_SCOPES).toEqual(['events:write', 'periods:read', 'reconciliation:write']);
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
