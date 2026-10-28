import type { INestApplicationContext } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOSS } from '../src/core/queue/queue.module.js';
import { jobs } from '../src/jobs/index.js';
import { HeartbeatJob } from '../src/jobs/system/heartbeat.job.js';
import { startWorker } from './worker.js';

describe('worker boot', () => {
  let worker: INestApplicationContext;
  let boss: PgBoss;
  const heartbeat = new HeartbeatJob();

  beforeAll(async () => {
    worker = await startWorker();
    boss = worker.get<PgBoss>(BOSS);
  });
  afterAll(() => worker.close());

  it('installs pg-boss as the queue role and schedules the heartbeat', async () => {
    expect(await boss.getSchedules(heartbeat.queue)).toEqual([
      expect.objectContaining({ name: heartbeat.queue, cron: heartbeat.cron }),
    ]);
  });

  it('schedules every job of the list', async () => {
    const queues = jobs.map((job) => worker.get(job).queue);
    expect(queues).toEqual([
      'system.heartbeat',
      'email.send',
      'system.clean-up',
      'ledger.daily-anchor',
      'company.export',
      'company.export-expire',
    ]);
    for (const queue of queues) expect(await boss.getSchedules(queue)).toHaveLength(1);
  });

  it('works a queued heartbeat job', async () => {
    const id = await boss.send(heartbeat.queue, {});
    expect(id).toEqual(expect.any(String));
    await expect
      .poll(async () => (await boss.getJobById(heartbeat.queue, id as string))?.state, {
        timeout: 15_000,
        interval: 250,
      })
      .toBe('completed');
  });

  it('keeps one schedule when a second worker boots', async () => {
    const second = await startWorker();
    try {
      expect(await boss.getSchedules(heartbeat.queue)).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});
