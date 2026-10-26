import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadConfig } from './core/config/config.js';
import { jobs } from './jobs/index.js';
import { WorkerModule } from './worker.module.js';

// No HTTP server: pg-boss's timers keep the process alive until a shutdown signal.
const config = loadConfig(process.env);
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config, jobs), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
