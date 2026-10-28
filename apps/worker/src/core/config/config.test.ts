import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_FILES_DIR, loadConfig } from './config.js';

const DATABASE_QUEUE_URL = 'postgres://mizan_queue:fake-password@127.0.0.1:55417/vertex_mizan';
const DATABASE_APP_URL = 'postgres://mizan_app:fake-password@127.0.0.1:55417/vertex_mizan';
const DATABASE_JOBS_URL = 'postgres://mizan_jobs:fake-password@127.0.0.1:55417/vertex_mizan';
const SMTP_URL = 'smtp://127.0.0.1:1025';
const EMAIL_FROM = 'Mizan <mizan@example.test>';
const base = { DATABASE_QUEUE_URL, DATABASE_APP_URL, DATABASE_JOBS_URL, SMTP_URL, EMAIL_FROM };

describe('loadConfig', () => {
  it('runs locally on defaults', () => {
    expect(loadConfig(base)).toEqual({
      queueDatabaseUrl: DATABASE_QUEUE_URL,
      appDatabaseUrl: DATABASE_APP_URL,
      jobsDatabaseUrl: DATABASE_JOBS_URL,
      appUrl: 'http://127.0.0.1:5173',
      filesDir: DEVELOPMENT_FILES_DIR,
      smtpUrl: SMTP_URL,
      emailFrom: EMAIL_FROM,
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
      const load = () => loadConfig({ ...base, DATABASE_QUEUE_URL: url });
      expect(load).toThrow('Invalid worker environment: DATABASE_QUEUE_URL');
      expect(load).not.toThrow(/secret-value/);
    }
    expect(() => loadConfig({})).toThrow(
      'Invalid worker environment: DATABASE_QUEUE_URL, DATABASE_APP_URL, DATABASE_JOBS_URL, SMTP_URL, EMAIL_FROM',
    );
  });

  it('reads the application tables as the app role only, and sends through SMTP', () => {
    for (const url of [
      'postgres://mizan_owner:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_jobs:secret-value@127.0.0.1:55417/vertex_mizan',
    ]) {
      const load = () => loadConfig({ ...base, DATABASE_APP_URL: url });
      expect(load).toThrow('Invalid worker environment: DATABASE_APP_URL');
      expect(load).not.toThrow(/secret-value/);
    }
    expect(() => loadConfig({ ...base, SMTP_URL: 'http://mail.example.test' })).toThrow(
      'Invalid worker environment: SMTP_URL',
    );
  });

  it('reaches across companies as the jobs role only', () => {
    for (const url of [
      'postgres://mizan_app:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_owner:secret-value@127.0.0.1:55417/vertex_mizan',
      'postgres://mizan_jobs:secret-value@127.0.0.1:55417/vertex_mizan?user=mizan_owner',
    ]) {
      const load = () => loadConfig({ ...base, DATABASE_JOBS_URL: url });
      expect(load).toThrow('Invalid worker environment: DATABASE_JOBS_URL');
      expect(load).not.toThrow(/secret-value/);
    }
  });

  it('keeps files in an absolute directory, required in production', () => {
    expect(loadConfig({ ...base, MIZAN_FILES_DIR: '/srv/mizan/files' }).filesDir).toBe(
      '/srv/mizan/files',
    );
    expect(() => loadConfig({ ...base, MIZAN_FILES_DIR: 'relative/files' })).toThrow(
      'Invalid worker environment: MIZAN_FILES_DIR',
    );
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'Invalid worker environment: MIZAN_FILES_DIR',
    );
    expect(loadConfig({ ...base, APP_URL: 'https://mizan.example.test/app/' }).appUrl).toBe(
      'https://mizan.example.test',
    );
  });
});
