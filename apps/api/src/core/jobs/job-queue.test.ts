import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config.js';

// The API's job producer: it sends what it is given to the named queue, nothing without the queue
// role's URL, and a failure to queue is no failure of the request. pg-boss is replaced: the
// worker's boot test works a real job.

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

const { JobQueue } = await import('./job-queue.js');

const config = (queueDatabaseUrl: string | null) => ({ queueDatabaseUrl }) as Config;
const fileId = '01934b6e-0000-7000-8000-000000000001';

afterEach(() => {
  sent.length = 0;
  failing = false;
});

describe('JobQueue', () => {
  it('queues the job on its queue', async () => {
    const queue = new JobQueue(config('postgres://mizan_queue:fake@127.0.0.1:1/db'));
    await queue.send('reports.render', { fileId });
    expect(sent).toEqual([{ queue: 'reports.render', data: { fileId } }]);
    await queue.onApplicationShutdown();
  });

  it('sends nothing without a queue URL, and survives a queue that is down', async () => {
    await new JobQueue(config(null)).send('reports.render', { fileId });
    expect(sent).toHaveLength(0);
    failing = true;
    const queue = new JobQueue(config('postgres://mizan_queue:fake@127.0.0.1:1/db'));
    await expect(queue.send('reports.render', { fileId })).resolves.toBeUndefined();
  });
});
