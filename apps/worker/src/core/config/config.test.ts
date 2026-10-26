import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_QUEUE_URL = 'postgres://mizan_queue:fake-password@127.0.0.1:55417/vertex_mizan';

describe('loadConfig', () => {
  it('runs locally on defaults', () => {
    expect(loadConfig({ DATABASE_QUEUE_URL })).toEqual({
      queueDatabaseUrl: DATABASE_QUEUE_URL,
      environment: 'development',
      logLevel: 'info',
    });
  });

  it('runs pg-boss as the queue role only', () => {
    for (const url of [
      'postgres://mizan_owner:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_app:secret-value@127.0.0.1:55417/vertex_mizan',
      `${DATABASE_QUEUE_URL}?user=mizan_owner`,
    ]) {
      const load = () => loadConfig({ DATABASE_QUEUE_URL: url });
      expect(load).toThrow('Invalid worker environment: DATABASE_QUEUE_URL');
      expect(load).not.toThrow(/secret-value/);
    }
    expect(() => loadConfig({})).toThrow('Invalid worker environment: DATABASE_QUEUE_URL');
  });
});
