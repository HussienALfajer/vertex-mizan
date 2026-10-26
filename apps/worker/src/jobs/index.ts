import type { Type } from '@nestjs/common';
import type { ScheduledJob } from '../core/queue/scheduled-job.js';
import { EmailSendJob } from './email/send.job.js';
import { CleanUpJob } from './system/clean-up.job.js';
import { HeartbeatJob } from './system/heartbeat.job.js';

/** Every scheduled job of the worker: one class per `jobs/<module>/<name>.job.ts`. */
export const jobs: Type<ScheduledJob>[] = [HeartbeatJob, EmailSendJob, CleanUpJob];
