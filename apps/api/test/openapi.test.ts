import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createOpenApiDocument } from '../src/app.js';
import { createTestApp } from './app.js';

let app: INestApplication;
let document: OpenAPIObject;

beforeAll(async () => {
  app = await createTestApp();
  document = createOpenApiDocument(app);
});
afterAll(() => app.close());

// The committed document is what Hub and the web app read (ADR 0006): a route or contract change
// that alters it fails here until the file is regenerated with `pnpm --filter @vertex-mizan/api
// test -u` and reviewed. CI also refuses a breaking change to it (`pnpm check:openapi`).
it('matches the committed openapi.json', async () => {
  await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot('../openapi.json');
});

it('documents the health answer from its contract, for 200 and 503', () => {
  const health = { $ref: '#/components/schemas/HealthResponse' };
  expect(document).toMatchObject({
    components: { schemas: { HealthResponse: { type: 'object' } } },
    paths: {
      '/api/health': {
        get: {
          responses: {
            200: { content: { 'application/json': { schema: health } } },
            503: { content: { 'application/json': { schema: health } } },
          },
        },
      },
    },
  });
});

// Generated clients refuse a document with a dangling reference.
it('refers only to schemas the document holds', () => {
  const references = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]+)"/g)].map(
    ([, reference]) => reference ?? '',
  );
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references) {
    const [, id = ''] = /^#\/components\/schemas\/(.+)$/.exec(reference) ?? [];
    expect(document.components?.schemas, reference).toHaveProperty([id]);
  }
});

// This build emits no decorator metadata; `createOpenApiDocument` declares the parameter types so
// bodies come from their contracts, and `ApiQueryFrom`/`ApiParamsFrom` document the rest.
it('documents request bodies, path and query parameters from their contracts', () => {
  expect(document.paths['/api/companies']?.post?.requestBody).toMatchObject({
    content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCompany' } } },
  });
  expect(document.paths['/api/members/{id}']?.patch?.parameters).toEqual([
    expect.objectContaining({ name: 'id', in: 'path', required: true }),
  ]);
  const query = document.paths['/api/audit']?.get?.parameters ?? [];
  expect(query.map((parameter) => ('name' in parameter ? parameter.name : ''))).toEqual([
    'from',
    'to',
    'actorUserId',
    'action',
    'entityType',
    'entityId',
    'cursor',
  ]);
});
