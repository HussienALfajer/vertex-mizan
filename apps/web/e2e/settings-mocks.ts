import { randomBytes } from 'node:crypto';
import {
  type ApiClient,
  type ApiClientKey,
  CHART_TEMPLATES,
  HUB_CURRENCIES,
  type NewApiKey,
  POSTING_SLOTS,
  type PostingRule,
  SLOT_READERS,
  slotIsPerCurrency,
} from '@vertex-mizan/contracts';
import { accountOf, chartReads } from './chart-mocks';

/*
 * S05's settings screens: the posting rules' mapping of a service-agency company with one slot
 * left unmapped and its held events, and a Hub client with an active and a revoked key.
 */

const mapping = CHART_TEMPLATES.find((template) => template.id === 'service-agency')?.postingRules;

/** The slot left unmapped, as a general-template company or an archived account leaves one. */
export const unmappedSlot = 'project_cost' as const;

/** Every slot mapped to the template's account but `project_cost`, which holds two events. */
export const postingRules: PostingRule[] = POSTING_SLOTS.flatMap((slot) =>
  (slotIsPerCurrency(slot) ? HUB_CURRENCIES : [null]).map((currency): PostingRule => {
    const code = mapping?.find((row) => row.slot === slot && row.currency === currency)?.code;
    const account = slot === unmappedSlot || !code ? null : accountOf(code);
    return {
      slot,
      currency,
      account: account && { id: account.id, code: account.code, name: account.name },
      events: [...SLOT_READERS[slot]],
      heldEvents: slot === unmappedSlot ? 2 : 0,
      updatedAt: account ? '2026-10-20T08:00:00.000Z' : null,
    };
  }),
);

/** The answer of mapping `project_cost` to its template account. */
export const mappedProjectCost: PostingRule = {
  slot: unmappedSlot,
  currency: null,
  account: { id: accountOf('511001').id, code: '511001', name: accountOf('511001').name },
  events: [...SLOT_READERS[unmappedSlot]],
  heldEvents: 2,
  updatedAt: '2026-11-03T09:00:00.000Z',
};

const clientId = '01900000-0000-7000-a100-000000000001';
const keyId = (n: number) => `01900000-0000-7000-a200-${String(n).padStart(12, '0')}`;

/** A key's prefix, `mzn_` and 8 characters, made at run time (the secret scan refuses literals). */
const prefixOf = (seed: string) => ['mzn', seed.repeat(8).slice(0, 8)].join('_');

export const activeKey: ApiClientKey = {
  id: keyId(1),
  prefix: prefixOf('A'),
  createdAt: '2026-10-20T08:10:00.000Z',
  lastUsedAt: '2026-11-03T07:58:00.000Z',
  lastUsedIp: '203.0.113.10',
  revokedAt: null,
  revokeReason: null,
};

export const revokedKey: ApiClientKey = {
  id: keyId(2),
  prefix: prefixOf('B'),
  createdAt: '2026-10-19T12:00:00.000Z',
  lastUsedAt: '2026-10-20T08:05:00.000Z',
  lastUsedIp: '203.0.113.10',
  revokedAt: '2026-10-20T08:20:00.000Z',
  revokeReason: 'تدوير المفتاح بعد نقل الخادم (مثال)',
};

export const hubClient: ApiClient = {
  id: clientId,
  name: 'Vertex Hub',
  system: 'hub',
  scopes: ['events:write', 'periods:read'],
  ipAllowList: ['203.0.113.10', '198.51.100.0/24'],
  documentTypes: ['invoice', 'payment', 'project_expense', 'ad_wallet_entry', 'ad_spend', 'rate'],
  createdAt: '2026-10-19T12:00:00.000Z',
  archivedAt: null,
  keys: [activeKey, revokedKey],
};

/** A fresh key's secret, made at run time: `mzn_` and 40 base62 characters. */
export function newSecret(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const body = [...randomBytes(40)].map((byte) => alphabet[byte % 62]).join('');
  return ['mzn', body].join('_');
}

/** The answer of a new key: its secret, shown once. */
export function newKeyOf(secret: string): NewApiKey {
  return {
    key: {
      id: keyId(3),
      prefix: secret.slice(0, 12),
      createdAt: '2026-11-03T09:00:00.000Z',
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      revokeReason: null,
    },
    secret,
  };
}

/** Every read of the settings screens, answered (with the chart, for the account picker). */
export const settingsReads = {
  ...chartReads,
  'GET /api/posting-rules': { status: 200, json: postingRules },
  'GET /api/api-clients': { status: 200, json: [hubClient] },
};
