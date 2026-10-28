import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_FILES_DIR, EXAMPLE_AUTH_SECRET, loadConfig } from './config.js';

const DATABASE_APP_URL = 'postgres://mizan_app:fake-password@127.0.0.1:55417/vertex_mizan';
const AUTH_SECRET = 'synthetic-auth-secret-of-at-least-32-characters';

describe('loadConfig', () => {
  it('runs locally on defaults', () => {
    expect(loadConfig({ DATABASE_APP_URL, AUTH_SECRET })).toEqual({
      databaseUrl: DATABASE_APP_URL,
      authSecret: AUTH_SECRET,
      appUrl: 'http://127.0.0.1:5173',
      host: '127.0.0.1',
      port: 3300,
      environment: 'development',
      logLevel: 'info',
      filesDir: DEVELOPMENT_FILES_DIR,
    });
    expect(DEVELOPMENT_FILES_DIR).toMatch(/[/\\]\.data[/\\]files$/);
  });

  it('keeps files in an absolute directory, given in production (S03)', () => {
    expect(
      loadConfig({ DATABASE_APP_URL, AUTH_SECRET, MIZAN_FILES_DIR: '/srv/mizan/files' }).filesDir,
    ).toBe('/srv/mizan/files');
    expect(() =>
      loadConfig({ DATABASE_APP_URL, AUTH_SECRET, MIZAN_FILES_DIR: 'relative/files' }),
    ).toThrow('Invalid API environment: MIZAN_FILES_DIR');
    expect(() => loadConfig({ DATABASE_APP_URL, AUTH_SECRET, NODE_ENV: 'production' })).toThrow(
      'Invalid API environment: MIZAN_FILES_DIR',
    );
  });

  it('names the variables that are wrong, never their values', () => {
    const load = () =>
      loadConfig({
        DATABASE_APP_URL: 'mysql://user:secret-value@host/db',
        AUTH_SECRET,
        API_PORT: '0',
      });
    expect(load).toThrow('Invalid API environment: DATABASE_APP_URL, API_PORT');
    expect(load).not.toThrow(/secret-value/);
    expect(() => loadConfig({})).toThrow('Invalid API environment: DATABASE_APP_URL, AUTH_SECRET');
  });

  it('connects as the app role only', () => {
    for (const url of [
      'postgres://mizan_owner:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_jobs:secret-value@127.0.0.1:55417/vertex_mizan',
      `${DATABASE_APP_URL}?user=mizan_owner`,
    ]) {
      const load = () => loadConfig({ DATABASE_APP_URL: url, AUTH_SECRET });
      expect(load).toThrow('Invalid API environment: DATABASE_APP_URL');
      expect(load).not.toThrow(/secret-value/);
    }
  });

  it('refuses a missing, short or example session secret', () => {
    for (const secret of [undefined, 'too-short', EXAMPLE_AUTH_SECRET]) {
      const load = () => loadConfig({ DATABASE_APP_URL, AUTH_SECRET: secret });
      expect(load).toThrow('Invalid API environment: AUTH_SECRET');
      if (secret) expect(load).not.toThrow(secret);
    }
  });

  it('keeps the web app origin only', () => {
    expect(
      loadConfig({ DATABASE_APP_URL, AUTH_SECRET, APP_URL: 'https://mizan.example.test/app/' }),
    ).toMatchObject({ appUrl: 'https://mizan.example.test' });
  });
});
