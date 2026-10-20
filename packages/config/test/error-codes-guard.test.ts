import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The error-code guard `scripts/error-codes-guard.mjs` (ADR 0006), run as CI runs it, against a
// throwaway repository whose base commit holds the published registry.
const script = fileURLToPath(new URL('../../../scripts/error-codes-guard.mjs', import.meta.url));
const realRepo = fileURLToPath(new URL('../../../', import.meta.url));

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function registry(entries: string): string {
  return `import { z } from 'zod';\n\n/** The codes. */\nexport const errorStatus = {\n${entries}\n} as const satisfies Record<string, number>;\n`;
}

const PUBLISHED = [
  '  // Money (ADR 0007).',
  '  /** Out of range. */',
  '  AMOUNT_OUT_OF_RANGE: 422,',
  '  /**',
  '   * A ledger rate is missing.',
  '   */',
  '  RATE_MISSING: 422,',
].join('\n');

/** A repository with `base` committed as `errors.ts`, then `head` written over it. */
function guard(base: string | null, head: string, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'error-codes-guard-'));
  dirs.push(dir);
  const git = (...gitArgs: string[]) => execFileSync('git', ['-C', dir, ...gitArgs]);
  git('init', '--quiet');
  writeFileSync(join(dir, 'README'), 'fixture\n');
  if (base !== null) writeFileSync(join(dir, 'errors.ts'), base);
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
  writeFileSync(join(dir, 'errors.ts'), head);
  const result = spawnSync(
    process.execPath,
    [script, '--repo', dir, '--file', 'errors.ts', '--base', 'HEAD', ...args],
    { encoding: 'utf8' },
  );
  return { status: result.status, output: result.stderr };
}

describe('error-code guard', () => {
  it('passes when codes are unchanged or appended', () => {
    expect(guard(registry(PUBLISHED), registry(PUBLISHED)).status).toBe(0);
    const appended = `${PUBLISHED}\n  // S01\n  NEW_CODE: 409,`;
    expect(guard(registry(PUBLISHED), registry(appended)).status).toBe(0);
  });

  it('passes when nothing was published at the base yet', () => {
    expect(guard(null, registry(PUBLISHED)).status).toBe(0);
  });

  it('fails on a removed, renamed or reordered code', () => {
    const removed = guard(registry(PUBLISHED), registry('  RATE_MISSING: 422,'));
    expect(removed).toMatchObject({ status: 1 });
    expect(removed.output).toContain('AMOUNT_OUT_OF_RANGE was renamed, removed or moved');
    const renamed = guard(
      registry(PUBLISHED),
      registry(PUBLISHED.replace('RATE_MISSING', 'MISSING_RATE')),
    );
    expect(renamed.output).toContain('RATE_MISSING was renamed, removed or moved');
    const last = guard(registry(PUBLISHED), registry('  AMOUNT_OUT_OF_RANGE: 422,'));
    expect(last.output).toContain('RATE_MISSING was removed');
    const reordered = guard(
      registry(PUBLISHED),
      registry('  RATE_MISSING: 422,\n  AMOUNT_OUT_OF_RANGE: 422,'),
    );
    expect(reordered.status).toBe(1);
  });

  it('fails on a changed status and a duplicate code', () => {
    const status = guard(
      registry(PUBLISHED),
      registry(PUBLISHED.replace('RATE_MISSING: 422', 'RATE_MISSING: 409')),
    );
    expect(status.output).toContain('RATE_MISSING changed status from 422 to 409');
    const twice = guard(registry(PUBLISHED), registry(`${PUBLISHED}\n  RATE_MISSING: 422,`));
    expect(twice.output).toContain('RATE_MISSING appears twice');
  });

  it('fails on a line it cannot read rather than skipping it', () => {
    const quoted = guard(registry(PUBLISHED), registry(`${PUBLISHED}\n  'QUOTED': 422,`));
    expect(quoted).toMatchObject({ status: 1 });
    expect(quoted.output).toContain('unrecognised line');
  });

  it('fails when the base is not a commit', () => {
    expect(guard(registry(PUBLISHED), registry(PUBLISHED), ['--base', 'no-such-ref']).status).toBe(
      2,
    );
  });

  it("reads this repository's registry", () => {
    const result = spawnSync(process.execPath, [script, '--repo', realRepo, '--base', 'HEAD'], {
      encoding: 'utf8',
    });
    expect(result.stderr).not.toContain('unrecognised line');
    expect(result.status).toBe(0);
  });
});
