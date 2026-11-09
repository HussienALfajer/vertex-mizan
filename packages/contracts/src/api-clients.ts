import { z } from 'zod';

/**
 * The systems that post to Mizan through an API client (S05 "API clients and sources"); more
 * later. A value is never renamed: stored clients carry it.
 */
export const API_CLIENT_SYSTEMS = ['hub'] as const;

export const apiClientSystemSchema = z.enum(API_CLIENT_SYSTEMS).meta({ id: 'ApiClientSystem' });

export type ApiClientSystem = z.infer<typeof apiClientSystemSchema>;

/**
 * What an API client's key may call (S05 "Access"): `events:write` for `POST /v1/events`,
 * `periods:read` for `GET /v1/periods/status`; `reconciliation:write` exists for S08. A scope is
 * never renamed: stored clients carry it.
 */
export const API_CLIENT_SCOPES = ['events:write', 'periods:read', 'reconciliation:write'] as const;

export const apiClientScopeSchema = z.enum(API_CLIENT_SCOPES).meta({ id: 'ApiClientScope' });

export type ApiClientScope = z.infer<typeof apiClientScopeSchema>;

/**
 * An API key (S05 "Data"): `mzn_` and 40 base62 characters from a CSPRNG (238 bits). Lists show
 * its prefix, `mzn_` and its first 8 characters; only the SHA-256 of the whole key is stored.
 */
export const API_KEY_PREFIX = 'mzn_';
export const API_KEY_SECRET_LENGTH = 40;
export const API_KEY_SHOWN_LENGTH = 8;

export const apiKeySchema = z
  .string()
  .regex(new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${API_KEY_SECRET_LENGTH}}$`));
