import { createTestDatabase } from '@vertex-mizan/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appUrl: string;
    jobsUrl: string;
  }
}

/**
 * A fresh migrated database for the book's run, dropped afterwards. The cases reach it as the
 * runtime roles only; each case creates its own company, which company isolation keeps apart.
 */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('appUrl', database.appUrl);
  project.provide('jobsUrl', database.jobsUrl);
  return database.drop;
}
