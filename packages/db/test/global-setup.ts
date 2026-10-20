import { readFileSync } from 'node:fs';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createTestDatabase } from '../src/testing.js';
import * as fixtures from './fixtures/schema.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseName: string;
    adminUrl: string;
    ownerUrl: string;
    appUrl: string;
    jobsUrl: string;
    queueUrl: string;
  }
}

/**
 * A fresh migrated database for this run, with the fixture tables and their guards added as the
 * owner role, its URLs handed to the tests, dropped afterwards. The superuser URL reaches the same
 * database, for the tests of what only a superuser can try.
 */
export default async function setup(project: TestProject) {
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!admin) {
    throw new Error(
      'DATABASE_ADMIN_URL is not set: the database tests need it (.env.example, packages/db/CLAUDE.md)',
    );
  }
  const database = await createTestDatabase();
  try {
    const empty = generateDrizzleJson({});
    const tables = await generateMigration(
      empty,
      generateDrizzleJson(fixtures, empty.id, undefined, 'snake_case'),
    );
    const guards = readFileSync(new URL('fixtures/guards.sql', import.meta.url), 'utf8');
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    await owner.connect();
    try {
      await owner.query('begin');
      for (const statement of tables) await owner.query(statement);
      await owner.query(guards);
      await owner.query('commit');
    } finally {
      await owner.end();
    }
  } catch (error) {
    await database.drop();
    throw error;
  }

  const adminUrl = new URL(admin);
  adminUrl.pathname = `/${database.name}`;
  project.provide('databaseName', database.name);
  project.provide('adminUrl', adminUrl.href);
  project.provide('ownerUrl', database.ownerUrl);
  project.provide('appUrl', database.appUrl);
  project.provide('jobsUrl', database.jobsUrl);
  project.provide('queueUrl', database.queueUrl);
  return database.drop;
}
