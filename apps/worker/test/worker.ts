import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { loadConfig } from '../src/core/config/config.js';
import {
  EMAIL_TRANSPORT,
  type EmailTransport,
  type OutgoingEmail,
} from '../src/core/email/email.module.js';
import { jobs } from '../src/jobs/index.js';
import { WorkerModule } from '../src/worker.module.js';

/** Keeps every email instead of sending it; `failNext` makes the next sends throw with a code. */
export class CapturingTransport implements EmailTransport {
  readonly sent: OutgoingEmail[] = [];
  failNext = 0;

  async send(email: OutgoingEmail): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw Object.assign(new Error('Connection refused for a synthetic test'), {
        code: 'ECONNECTION',
      });
    }
    this.sent.push(email);
  }
}

/** The worker as `main.ts` builds it, on this run's test database, with a capturing transport. */
export async function startWorker(
  transport: EmailTransport = new CapturingTransport(),
): Promise<INestApplicationContext> {
  const config = loadConfig({
    DATABASE_QUEUE_URL: inject('queueUrl'),
    DATABASE_APP_URL: inject('appUrl'),
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'Mizan <mizan@example.test>',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(config, jobs)],
  })
    .overrideProvider(EMAIL_TRANSPORT)
    .useValue(transport)
    .compile();
  return moduleRef.init();
}
