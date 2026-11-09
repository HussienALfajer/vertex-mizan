import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ApiClientScope, CreatedApiClient } from '@vertex-mizan/contracts';
import request, { type Response } from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { expect } from 'vitest';
import type { Browser } from './browser.js';
import { reauthenticate, type TestPerson } from './people.js';

// Hub as the API sees it (S05): a client made by the owner after a fresh code, whose key travels
// as `Authorization: Bearer`, from an address of its own. The key is made at run time by the API;
// no secret is written here. Every value is synthetic.

/** A Hub server's address, from the documentation range, one per client. */
export const hubAddress = () => `192.0.2.${randomInt(1, 255)}`;

export interface HubClient {
  readonly id: string;
  readonly key: string;
  readonly address: string;
  /** `POST /v1/events` with the envelope's id as `Idempotency-Key`, unless `headers` says else. */
  send(
    envelope: { id: string; [field: string]: unknown },
    headers?: Record<string, string>,
  ): Promise<Response>;
  get(path: string, query?: Record<string, string>): Promise<Response>;
}

/** A request to `/v1` with a key, from an address. */
export function v1(
  app: INestApplication,
  key: string | null,
  address: string,
): {
  post: (path: string, body: object, headers?: Record<string, string>) => Promise<Response>;
  get: (path: string, query?: Record<string, string>) => Promise<Response>;
} {
  const authorized = (call: request.Test) => {
    let sent = call.set('x-forwarded-for', address);
    if (key !== null) sent = sent.set('authorization', `Bearer ${key}`);
    return sent;
  };
  return {
    post: (path, body, headers = {}) => {
      let call = authorized(request(app.getHttpServer()).post(path));
      for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
      return call.send(body);
    },
    get: (path, query = {}) => authorized(request(app.getHttpServer()).get(path)).query(query),
  };
}

/** The owner creates a client and its first key (rule 19) and Hub starts sending with it. */
export async function hubClient(
  app: INestApplication,
  owner: { browser: Browser; person: TestPerson },
  options: { name?: string; scopes?: ApiClientScope[]; ipAllowList?: string[] } = {},
): Promise<HubClient> {
  await reauthenticate(owner.browser, owner.person);
  const created = await owner.browser.post('/api/api-clients', {
    name: options.name ?? `Vertex Hub ${uuidv7().slice(-6)}`,
    system: 'hub',
    scopes: options.scopes ?? ['events:write', 'periods:read'],
    ipAllowList: options.ipAllowList ?? [],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const body = created.body as CreatedApiClient;
  return clientOf(app, body.client.id, body.key.secret);
}

export function clientOf(
  app: INestApplication,
  id: string,
  key: string,
  address = hubAddress(),
): HubClient {
  const api = v1(app, key, address);
  return {
    id,
    key,
    address,
    send: (envelope, headers = {}) =>
      api.post('/v1/events', envelope, { 'idempotency-key': envelope.id, ...headers }),
    get: api.get,
  };
}

const ids = () => uuidv7();

/** A client, a service and an invoice of Hub, made fresh for each test. */
export function hubDocuments() {
  return {
    client: { external_id: ids(), code: `C${randomInt(1000, 9999)}`, name: 'عميل تجريبي' },
    service: { external_id: ids(), code: `S${randomInt(1000, 9999)}`, name: 'خدمة تجريبية' },
    invoice: { id: ids(), number: `INV-2026-${randomInt(1000, 9999)}` },
  };
}

/** `invoice.issued` of one extra-work line in USD, dated `on`. */
export function invoiceIssued(
  documents: ReturnType<typeof hubDocuments>,
  on: string,
  amount = 50_000,
) {
  return {
    id: ids(),
    type: 'invoice.issued',
    version: 1,
    occurred_at: `${on}T09:00:00+03:00`,
    accounting_date: on,
    payload: {
      invoice: documents.invoice,
      client: documents.client,
      currency: 'USD',
      syp_per_usd: '122.0000',
      issued_on: on,
      due_on: on,
      lines: [{ id: ids(), amount, service: documents.service, source: 'extra_work' }],
    },
  };
}

/** `payment.recorded` of the whole invoice by bank transfer in USD, dated `on`. */
export function paymentRecorded(
  documents: ReturnType<typeof hubDocuments>,
  on: string,
  amount = 50_000,
) {
  return {
    id: ids(),
    type: 'payment.recorded',
    version: 1,
    occurred_at: `${on}T10:00:00+03:00`,
    accounting_date: on,
    payload: {
      payment: { id: ids(), number: `R-2026-${randomInt(1000, 9999)}` },
      invoice: documents.invoice,
      paid_on: on,
      method: 'bank_transfer',
      currency: 'USD',
      amount,
      syp_per_usd: '122.0000',
      applied_amount: amount,
      invoice_currency: 'USD',
    },
  };
}
