import { z } from 'zod';
import { documentTypeSchema } from './events.js';

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
export const API_CLIENT_SCOPES = [
  'events:write',
  'periods:read',
  'reconciliation:write',
  // S10: Hub's opening snapshot.
  'opening:write',
] as const;

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
  .regex(new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${API_KEY_SECRET_LENGTH}}$`))
  .meta({ id: 'ApiKey' });

/** An IPv4 or IPv6 address as a number, or null for any other text. */
function addressValue(text: string): { value: bigint; bits: number } | null {
  if (z.ipv4().safeParse(text).success) {
    const value = text.split('.').reduce((sum, part) => sum * 256n + BigInt(part), 0n);
    return { value, bits: 32 };
  }
  if (!z.ipv6().safeParse(text).success || text.includes('.')) return null;
  const [head = '', tail] = text.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const start = groups(head);
  const end = tail === undefined ? [] : groups(tail);
  const all = [...start, ...Array(8 - start.length - end.length).fill('0'), ...end];
  if (all.length !== 8) return null;
  return { value: all.reduce((sum, group) => sum * 65536n + BigInt(`0x${group}`), 0n), bits: 128 };
}

/**
 * An entry of an IP allow-list (S05 rule 20): an address, or a network as PostgreSQL's `cidr`
 * stores it, with no bit set after its mask (`10.0.0.0/8`, not `10.0.0.1/8`). IPv4-mapped IPv6
 * text is refused: write the IPv4 address.
 */
export const allowedNetworkSchema = z
  .string()
  .trim()
  .max(43)
  .refine(
    (text) => {
      const [address = '', mask, extra] = text.split('/');
      if (extra !== undefined) return false;
      const parsed = addressValue(address);
      if (!parsed) return false;
      if (mask === undefined) return true;
      if (!/^\d{1,3}$/.test(mask) || Number(mask) > parsed.bits) return false;
      const hostBits = BigInt(parsed.bits - Number(mask));
      return parsed.value % (1n << hostBits) === 0n;
    },
    { message: 'An address, or a network with no bit set after its mask' },
  );

export const ipAllowListSchema = z.array(allowedNetworkSchema).max(50);

const clientNameSchema = z.string().trim().min(1).max(100);

const scopesSchema = z
  .array(apiClientScopeSchema)
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length, { message: 'A scope twice' });

const instantSchema = z.iso.datetime({ offset: true });

/** The scopes that put a client in the daily reconciliation (S08 rule 13). */
export const RECONCILED_SCOPES: readonly ApiClientScope[] = [
  'events:write',
  'reconciliation:write',
];

/** Whether a client with these scopes needs a reconciliation start date (S08 "Data"). */
export function needsReconcileFrom(scopes: readonly ApiClientScope[]): boolean {
  return scopes.some((scope) => RECONCILED_SCOPES.includes(scope));
}

/** The first accounting date a client's daily reports must cover (S08 rule 13). */
const reconcileFromSchema = z.iso.date();

/** A key as lists show it (S05 "Screens"): never its secret, which only its creation answers. */
export const apiClientKeySchema = z
  .object({
    id: z.uuid(),
    prefix: z.string(),
    createdAt: instantSchema,
    lastUsedAt: instantSchema.nullable(),
    lastUsedIp: z.string().nullable(),
    revokedAt: instantSchema.nullable(),
    revokeReason: z.string().nullable(),
  })
  .meta({ id: 'ApiClientKey' });

export type ApiClientKey = z.infer<typeof apiClientKeySchema>;

/** A client with its keys, newest first, and the document types it is the source of. */
export const apiClientSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    system: apiClientSystemSchema,
    scopes: z.array(apiClientScopeSchema),
    ipAllowList: z.array(z.string()),
    documentTypes: z.array(documentTypeSchema),
    /** S08: set once the client holds `events:write` or `reconciliation:write`, never cleared. */
    reconcileFrom: reconcileFromSchema.nullable(),
    createdAt: instantSchema,
    archivedAt: instantSchema.nullable(),
    keys: z.array(apiClientKeySchema),
  })
  .meta({ id: 'ApiClient' });

export type ApiClient = z.infer<typeof apiClientSchema>;

/** `POST /api/api-clients` (rule 19), with S08's start date when a scope needs it. */
export const createApiClientSchema = z
  .object({
    name: clientNameSchema,
    system: apiClientSystemSchema,
    scopes: scopesSchema,
    ipAllowList: ipAllowListSchema,
    reconcileFrom: reconcileFromSchema.optional(),
  })
  .refine((client) => !needsReconcileFrom(client.scopes) || client.reconcileFrom !== undefined, {
    path: ['reconcileFrom'],
    message: 'A client with events:write or reconciliation:write needs its start date',
  })
  .meta({ id: 'CreateApiClient' });

export type CreateApiClient = z.infer<typeof createApiClientSchema>;

/**
 * `PUT /api/api-clients/:id`: the fields given change. `documentTypes` is the whole list the
 * client is the source of: a type given moves to it from another client or from none, a type it
 * held and no longer lists goes to none (rule 21). `reconcileFrom` (S08 rule 13) sets or moves the
 * start date; it is never cleared, and the API refuses scopes that need it on a client without one.
 */
export const updateApiClientSchema = z
  .object({
    name: clientNameSchema.optional(),
    scopes: scopesSchema.optional(),
    ipAllowList: ipAllowListSchema.optional(),
    documentTypes: z
      .array(documentTypeSchema)
      .refine((types) => new Set(types).size === types.length, { message: 'A type twice' })
      .optional(),
    reconcileFrom: reconcileFromSchema.optional(),
  })
  .meta({ id: 'UpdateApiClient' });

export type UpdateApiClient = z.infer<typeof updateApiClientSchema>;

/** A new key with its secret, shown once (rule 19). */
export const newApiKeySchema = z
  .object({ key: apiClientKeySchema, secret: apiKeySchema })
  .meta({ id: 'NewApiKey' });

export type NewApiKey = z.infer<typeof newApiKeySchema>;

/** The answer of a client's creation: the client and its first key, shown once. */
export const createdApiClientSchema = z
  .object({ client: apiClientSchema, key: newApiKeySchema })
  .meta({ id: 'CreatedApiClient' });

export type CreatedApiClient = z.infer<typeof createdApiClientSchema>;

/** The path of a client's key. */
export const apiClientKeyParamsSchema = z
  .object({ id: z.uuid(), keyId: z.uuid() })
  .meta({ id: 'ApiClientKeyParams' });

export type ApiClientKeyParams = z.infer<typeof apiClientKeyParamsSchema>;

/** `POST /api/api-clients/:id/keys/:keyId/revoke`: a written reason, kept with the key. */
export const revokeApiKeySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'RevokeApiKey' });

export type RevokeApiKey = z.infer<typeof revokeApiKeySchema>;
