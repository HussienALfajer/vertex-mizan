import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_APP_URL = 'postgres://mizan_app:fake-password@127.0.0.1:55417/vertex_mizan';

describe('loadConfig', () => {
  it('runs locally on defaults', () => {
    expect(loadConfig({ DATABASE_APP_URL })).toEqual({
      databaseUrl: DATABASE_APP_URL,
      host: '127.0.0.1',
      port: 3300,
      environment: 'development',
      logLevel: 'info',
    });
  });

  it('names the variables that are wrong, never their values', () => {
    const load = () =>
      loadConfig({ DATABASE_APP_URL: 'mysql://user:secret-value@host/db', API_PORT: '0' });
    expect(load).toThrow('Invalid API environment: DATABASE_APP_URL, API_PORT');
    expect(load).not.toThrow(/secret-value/);
    expect(() => loadConfig({})).toThrow('Invalid API environment: DATABASE_APP_URL');
  });

  it('connects as the app role only', () => {
    for (const url of [
      'postgres://mizan_owner:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_jobs:secret-value@127.0.0.1:55417/vertex_mizan',
      `${DATABASE_APP_URL}?user=mizan_owner`,
    ]) {
      const load = () => loadConfig({ DATABASE_APP_URL: url });
      expect(load).toThrow('Invalid API environment: DATABASE_APP_URL');
      expect(load).not.toThrow(/secret-value/);
    }
  });
});
