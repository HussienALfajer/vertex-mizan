import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The OpenAPI breaking-change guard `scripts/openapi-guard.mjs` (ADR 0006), run as CI runs it,
// against a throwaway repository whose base commit holds the published document. It needs oasdiff:
// CI installs it (scripts/install-oasdiff.sh) and must run these tests; elsewhere they run when
// oasdiff is on the PATH or named by OASDIFF.
const script = fileURLToPath(new URL('../../../scripts/openapi-guard.mjs', import.meta.url));
const oasdiff = process.env.OASDIFF || 'oasdiff';
const available = spawnSync(oasdiff, ['--version']).status === 0;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const status = { type: 'string', enum: ['ok', 'error'] };

/** A document with one route answering `schema`, plus `paths`. */
function document(schema: object, paths: object = {}): string {
  const answer = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
  });
  return `${JSON.stringify(
    {
      openapi: '3.0.0',
      info: { title: 'Fixture', version: '0.0.0' },
      paths: { '/api/health': { get: { responses: { 200: answer('Up') } } }, ...paths },
      components: { schemas: { Health: schema } },
    },
    null,
    2,
  )}\n`;
}

const PUBLISHED = document({
  type: 'object',
  properties: { status },
  required: ['status'],
});

/** A repository with `base` committed as `openapi.json`, then `head` written over it. */
function guard(base: string | null, head: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-guard-'));
  dirs.push(dir);
  const git = (...gitArgs: string[]) => execFileSync('git', ['-C', dir, ...gitArgs]);
  git('init', '--quiet');
  writeFileSync(join(dir, 'README'), 'fixture\n');
  if (base !== null) writeFileSync(join(dir, 'openapi.json'), base);
  git('add', '--all');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '-m',
    'base',
  );
  if (head === null) rmSync(join(dir, 'openapi.json'));
  else writeFileSync(join(dir, 'openapi.json'), head);
  const result = spawnSync(
    process.execPath,
    [script, '--repo', dir, '--file', 'openapi.json', '--base', 'HEAD'],
    { encoding: 'utf8', env: { ...process.env, OASDIFF: oasdiff } },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe.runIf(available || process.env.CI)('openapi guard', () => {
  it('passes when nothing is published yet', () => {
    expect(guard(null, PUBLISHED)).toMatchObject({
      status: 0,
      output: expect.stringContaining('nothing published yet'),
    });
  });

  it('passes an unchanged document and additive changes', () => {
    expect(guard(PUBLISHED, PUBLISHED).status).toBe(0);
    const added = document(
      {
        type: 'object',
        properties: { status, version: { type: 'string' } },
        required: ['status'],
      },
      { '/api/version': { get: { responses: { 200: { description: 'The version' } } } } },
    );
    expect(guard(PUBLISHED, added).status).toBe(0);
  });

  // ADR 0006: an appended error code, audit action or event type is additive (owner, 2026-10-27).
  it('passes a value added to an enum in an answer, and fails when one is removed', () => {
    const more = document({
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok', 'error', 'degraded'] } },
      required: ['status'],
    });
    expect(guard(PUBLISHED, more).status).toBe(0);
    expect(guard(more, PUBLISHED).status).toBe(1);
  });

  it('fails when a route disappears', () => {
    const withRoute = document(
      { type: 'object', properties: { status }, required: ['status'] },
      { '/api/version': { get: { responses: { 200: { description: 'The version' } } } } },
    );
    expect(guard(withRoute, PUBLISHED)).toMatchObject({
      status: 1,
      output: expect.stringContaining('additively only'),
    });
  });

  it('fails when an answer loses a required field', () => {
    const fewer = document({ type: 'object', properties: { status } });
    expect(guard(PUBLISHED, fewer).status).toBe(1);
  });

  // oasdiff reports these as `info`; scripts/oasdiff-severity-levels.txt raises them.
  it('fails when an answer loses an optional field', () => {
    const optional = document({
      type: 'object',
      properties: { status, version: { type: 'string' } },
      required: ['status'],
    });
    expect(guard(optional, PUBLISHED).status).toBe(1);
  });

  it('fails when a documented error answer is removed', () => {
    const withError = PUBLISHED.replace(
      '"200": {',
      '"409": {\n            "description": "Conflict"\n          },\n          "200": {',
    );
    expect(withError).not.toBe(PUBLISHED);
    expect(guard(withError, PUBLISHED).status).toBe(1);
  });

  it('fails when an operation id is removed', () => {
    const withId = PUBLISHED.replace('"get": {', '"get": {\n        "operationId": "health",');
    expect(withId).not.toBe(PUBLISHED);
    expect(guard(withId, PUBLISHED).status).toBe(1);
  });

  it('fails when the document itself is removed', () => {
    expect(guard(PUBLISHED, null)).toMatchObject({
      status: 1,
      output: expect.stringContaining('was removed'),
    });
  });
});

it('reports a missing oasdiff instead of passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-guard-'));
  dirs.push(dir);
  const git = (...gitArgs: string[]) => execFileSync('git', ['-C', dir, ...gitArgs]);
  git('init', '--quiet');
  writeFileSync(join(dir, 'openapi.json'), PUBLISHED);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'base');
  const result = spawnSync(
    process.execPath,
    [script, '--repo', dir, '--file', 'openapi.json', '--base', 'HEAD'],
    { encoding: 'utf8', env: { ...process.env, OASDIFF: join(dir, 'no-such-oasdiff') } },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('cannot run');
});
