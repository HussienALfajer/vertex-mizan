import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@vertex-mizan/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';

describe('GET /api/health', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('answers 200 ok when the database answers', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(healthResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers 503 with the database down when it does not answer', async () => {
    app = await createTestApp({
      databaseUrl: 'postgres://mizan_app:unused@127.0.0.1:1/vertex_mizan',
    });
    const response = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(healthResponseSchema.parse(response.body)).toMatchObject({
      status: 'error',
      checks: { database: 'down' },
    });
  });
});
