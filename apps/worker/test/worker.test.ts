import type { INestApplicationContext } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOSS } from '../src/core/queue/queue.module.js';
import { isScheduled } from '../src/core/queue/scheduled-job.js';
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

  it('schedules every scheduled job of the list and works the queues the API sends to', async () => {
    const all = jobs.map((job) => worker.get(job));
    expect(all.map((job) => job.queue)).toEqual([
      'system.heartbeat',
      'email.send',
      'system.clean-up',
      'ledger.daily-anchor',
      'company.export',
      'company.export-expire',
      'events.retry',
      'events.retry-sweep',
      'events.held-digest',
    ]);
    for (const job of all) {
      expect(await boss.getSchedules(job.queue), job.queue).toHaveLength(isScheduled(job) ? 1 : 0);
      expect(await boss.getQueue(job.queue), job.queue).not.toBeNull();
    }
  });

  it('works an events.retry job the API queued, and runs the sweep at start', async () => {
    const id = await boss.send('events.retry', {
      companyId: uuidv7(),
      triggers: [{ kind: 'sweep' }],
    });
    await expect
      .poll(async () => (await boss.getJobById('events.retry', id as string))?.state, {
        timeout: 15_000,
        interval: 250,
      })
      .toBe('completed');
    await expect
      .poll(async () => (await boss.findJobs('events.retry-sweep')).length, {
        timeout: 15_000,
        interval: 250,
      })
      .toBeGreaterThan(0);
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
