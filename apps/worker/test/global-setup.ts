import { createTestDatabase } from '@vertex-mizan/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    queueUrl: string;
    appUrl: string;
  }
}

/** A fresh migrated database for this run: pg-boss connects as the queue role, the jobs as the app role. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('queueUrl', database.queueUrl);
  project.provide('appUrl', database.appUrl);
  return database.drop;
}
