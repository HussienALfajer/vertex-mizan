import { createTestDatabase } from '@vertex-mizan/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    queueUrl: string;
    appUrl: string;
    jobsUrl: string;
  }
}

/** A fresh migrated database for this run: pg-boss connects as the queue role, the jobs as the app and jobs roles. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('queueUrl', database.queueUrl);
  project.provide('appUrl', database.appUrl);
  project.provide('jobsUrl', database.jobsUrl);
  return database.drop;
}
