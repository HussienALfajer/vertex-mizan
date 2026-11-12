import { createTestDatabase } from '@vertex-mizan/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    /** The jobs role, for what only the worker writes: the daily anchors (S03). */
    jobsUrl: string;
  }
}

/** A fresh migrated database for this run; the API connects to it as the app role. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('databaseUrl', database.appUrl);
  project.provide('jobsUrl', database.jobsUrl);
  return database.drop;
}
