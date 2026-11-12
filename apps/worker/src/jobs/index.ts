import type { Type } from '@nestjs/common';
import type { WorkerJob } from '../core/queue/scheduled-job.js';
import { CompanyExportJob } from './company/export.job.js';
import { CompanyExportExpireJob } from './company/export-expire.job.js';
import { EmailSendJob } from './email/send.job.js';
import { EventsHeldDigestJob } from './events/held-digest.job.js';
import { EventsRetryJob } from './events/retry.job.js';
import { EventsRetrySweepJob } from './events/retry-sweep.job.js';
import { DailyAnchorJob } from './ledger/daily-anchor.job.js';
import { ReportsFilesExpireJob } from './reports/files-expire.job.js';
import { ReportsRenderJob } from './reports/render.job.js';
import { RevenueReleaseMonthJob } from './revenue/release-month.job.js';
import { CleanUpJob } from './system/clean-up.job.js';
import { HeartbeatJob } from './system/heartbeat.job.js';

/** Every job of the worker, scheduled or worked: one class per `jobs/<module>/<name>.job.ts`. */
export const jobs: Type<WorkerJob>[] = [
  HeartbeatJob,
  EmailSendJob,
  CleanUpJob,
  DailyAnchorJob,
  CompanyExportJob,
  CompanyExportExpireJob,
  EventsRetryJob,
  EventsRetrySweepJob,
  EventsHeldDigestJob,
  RevenueReleaseMonthJob,
  ReportsRenderJob,
  ReportsFilesExpireJob,
];
