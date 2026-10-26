import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { configureApp } from '../src/app.js';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/core/config/config.js';

/**
 * The session and two-factor key of this test run: random, so no secret-looking literal sits in
 * the repository (the secret scan, CI).
 */
export const TEST_AUTH_SECRET = randomBytes(32).toString('base64url');

/** The API as production builds it, on this run's test database. Close it after the test. */
export async function createTestApp(
  options: { databaseUrl?: string } = {},
): Promise<INestApplication> {
  const config = loadConfig({
    DATABASE_APP_URL: options.databaseUrl ?? inject('databaseUrl'),
    AUTH_SECRET: TEST_AUTH_SECRET,
    APP_URL: 'http://mizan.test',
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }), config);
  await app.init();
  return app;
}
