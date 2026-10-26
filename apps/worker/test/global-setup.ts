import { createTestDatabase } from '@vertex-mizan/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    queueUrl: string;
  }
}

/** A fresh migrated database for this run; pg-boss connects to it as the queue role. */
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide('queueUrl', database.queueUrl);
  return database.drop;
}
