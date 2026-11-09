import { eventsRetryJobSchema } from '@vertex-mizan/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config.js';

// The API's producer of `events.retry` (S05 "Jobs"): what it sends is what the worker parses, it
// sends nothing without the queue role's URL or triggers, and a failure to queue is no failure of
// the request. pg-boss is replaced: the worker's boot test works a real job.

const sent: { queue: string; data: unknown }[] = [];
let failing = false;

vi.mock('pg-boss', () => ({
  PgBoss: class {
    on() {}
    async start() {}
    async stop() {}
    async send(queue: string, data: unknown) {
      if (failing) throw new Error('queue down');
      sent.push({ queue, data });
      return 'job-id';
    }
  },
}));

const { RetryQueue } = await import('./retry-queue.js');

const config = (queueDatabaseUrl: string | null) => ({ queueDatabaseUrl }) as Config;
const companyId = '01934b6e-0000-7000-8000-000000000001';

afterEach(() => {
  sent.length = 0;
  failing = false;
});

describe('RetryQueue', () => {
  it('queues the company and its triggers as the worker reads them', async () => {
    const queue = new RetryQueue(config('postgres://mizan_queue:fake@127.0.0.1:1/db'));
    await queue.afterCommit(companyId, [{ kind: 'rate', on: '2026-11-09' }, { kind: 'mapping' }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.queue).toBe('events.retry');
    expect(eventsRetryJobSchema.parse(sent[0]?.data)).toEqual({
      companyId,
      triggers: [{ kind: 'rate', on: '2026-11-09' }, { kind: 'mapping' }],
    });
    await queue.onApplicationShutdown();
  });

  it('sends nothing without triggers or a queue URL, and survives a queue that is down', async () => {
    await new RetryQueue(config(null)).afterCommit(companyId, [{ kind: 'mapping' }]);
    const queue = new RetryQueue(config('postgres://mizan_queue:fake@127.0.0.1:1/db'));
    await queue.afterCommit(companyId, []);
    expect(sent).toHaveLength(0);
    failing = true;
    await expect(queue.afterCommit(companyId, [{ kind: 'mapping' }])).resolves.toBeUndefined();
  });
});
