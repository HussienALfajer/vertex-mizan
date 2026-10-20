import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { withCompany } from '../src/index.js';
import { connect, refusal } from './connections.js';
import { fixtureDocuments, fixtureSettings } from './fixtures/schema.js';

// What each role can try against the running database, beyond the privileges the convention test
// reads: the app role cannot step around RLS or the guards, and the queue role reaches no table.

const { app, jobs, queue } = connect();
const DENIED = /permission denied/;

describe('the app role', () => {
  it('cannot turn row security off: the query fails instead of seeing every company', async () => {
    const client = await app.$client.connect();
    try {
      await client.query('set row_security = off');
      expect(await refusal(client.query('select * from fixture_documents'))).toMatch(
        /row-level security policy/,
      );
    } finally {
      client.release(true);
    }
  });

  it('cannot disable or drop a policy, a trigger or a table it does not own', async () => {
    for (const statement of [
      'alter table fixture_documents disable row level security',
      'alter table fixture_documents no force row level security',
      'drop policy company_isolation on fixture_documents',
      'create policy fixture_open on fixture_documents using (true)',
      'alter table fixture_lines disable trigger fixture_lines_refuse_change',
      'alter table fixture_lines enable trigger fixture_lines_balance',
      'drop trigger fixture_lines_refuse_change on fixture_lines',
      'drop table fixture_settings',
    ]) {
      expect(await refusal(app.$client.query(statement)), statement).toMatch(/must be owner/);
    }
  });

  it('cannot empty a table, which would ignore RLS', async () => {
    for (const table of ['fixture_documents', 'fixture_entries', 'fixture_settings']) {
      expect(await refusal(app.$client.query(`truncate ${table}`)), table).toMatch(DENIED);
    }
  });

  it('cannot delete a business record: records are archived', async () => {
    expect(await refusal(withCompany(app, uuidv7(), (tx) => tx.delete(fixtureDocuments)))).toMatch(
      DENIED,
    );
  });

  it('cannot switch to another role or create objects', async () => {
    for (const role of ['mizan_owner', 'mizan_jobs', 'mizan_queue', 'postgres']) {
      expect(await refusal(app.$client.query(`set role ${role}`)), role).toMatch(DENIED);
    }
    for (const statement of [
      'create table spare (id uuid)',
      'create schema spare',
      'create table pgboss.spare (id uuid)',
      'create function spare() returns int language sql as $$ select 1 $$',
    ]) {
      expect(await refusal(app.$client.query(statement)), statement).toMatch(DENIED);
    }
  });

  it('cannot create a temporary table, which a guard function would read in place of its own', async () => {
    const client = await app.$client.connect();
    try {
      expect(
        await refusal(client.query('create temp table fixture_lines (amount_minor bigint)')),
      ).toMatch(/permission denied to create temporary tables/);
    } finally {
      client.release(true);
    }
  });

  it('cannot replace the functions the policies and the guards call', async () => {
    for (const statement of [
      'create or replace function current_company_id() returns uuid language sql as $$ select null::uuid $$',
      'create or replace function refuse_change() returns trigger language plpgsql as $$ begin return new; end $$',
      'alter function current_company_id() security definer',
    ]) {
      expect(await refusal(app.$client.query(statement)), statement).toMatch(
        /must be owner|permission denied/,
      );
    }
  });
});

describe('the jobs role', () => {
  it('reaches no table and creates nothing until a migration grants it a job', async () => {
    expect(await refusal(jobs.select().from(fixtureSettings))).toMatch(DENIED);
    expect(await refusal(jobs.$client.query('create table spare (id uuid)'))).toMatch(DENIED);
    expect(await refusal(jobs.$client.query('set role mizan_owner'))).toMatch(DENIED);
    expect(await refusal(jobs.$client.query('create temp table spare (id uuid)'))).toMatch(DENIED);
  });
});

describe('the queue role', () => {
  it('reaches no table, with or without a company context', async () => {
    expect(await refusal(queue.query('select * from fixture_settings'))).toMatch(DENIED);
    const client = await queue.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.company_id', $1, true)`, [uuidv7()]);
      expect(await refusal(client.query('select * from fixture_documents'))).toMatch(DENIED);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('creates in the pg-boss schema only', async () => {
    const client = await queue.connect();
    try {
      await client.query('begin');
      await client.query('create table pgboss.fixture_job (id uuid)');
      expect(await refusal(client.query('create table public.fixture_job (id uuid)'))).toMatch(
        DENIED,
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect(await refusal(queue.query('create temp table fixture_job (id uuid)'))).toMatch(DENIED);
  });
});
