import type { Type } from '@nestjs/common';
import type { ScheduledJob } from '../core/queue/scheduled-job.js';
import { CompanyExportJob } from './company/export.job.js';
import { CompanyExportExpireJob } from './company/export-expire.job.js';
import { EmailSendJob } from './email/send.job.js';
import { DailyAnchorJob } from './ledger/daily-anchor.job.js';
import { CleanUpJob } from './system/clean-up.job.js';
import { HeartbeatJob } from './system/heartbeat.job.js';

/** Every scheduled job of the worker: one class per `jobs/<module>/<name>.job.ts`. */
export const jobs: Type<ScheduledJob>[] = [
  HeartbeatJob,
  EmailSendJob,
  CleanUpJob,
  DailyAnchorJob,
  CompanyExportJob,
  CompanyExportExpireJob,
];
