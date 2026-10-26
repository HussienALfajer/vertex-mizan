import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The Claude Code hook `.claude/hooks/test-guard.mjs`, run as Claude Code runs it: the tool's input
// as JSON on stdin; exit code 2 refuses the command. A copy runs in a throwaway repository with its
// own temporary folder, so this repository's own test runs (this one included) and a real verify
// lock are not what it sees.
const source = fileURLToPath(new URL('../../../.claude/hooks/test-guard.mjs', import.meta.url));

let repo = '';
let temp = '';
let hook = '';

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'test-guard-'));
  temp = join(repo, 'tmp');
  mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true });
  mkdirSync(temp);
  hook = join(repo, '.claude', 'hooks', 'test-guard.mjs');
  copyFileSync(source, hook);
  spawnSync('git', ['init', '--quiet', repo]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function guard(command: string): { refused: boolean; message: string } {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
  });
  if (result.status !== 0 && result.status !== 2) throw new Error(result.stderr);
  return { refused: result.status === 2, message: result.stderr };
}

const lockFile = () => join(temp, 'vertex-mizan-verify.lock');

describe('test guard: commands', () => {
  it('lets commands that run no tests through', () => {
    for (const command of [
      'git status',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm build',
      'pnpm check:migrations',
      'timeout 5 git fetch',
      // A heredoc's text is data: a commit message that names test commands runs none.
      "git commit -F - <<'EOF'\npnpm test and pnpm exec playwright test\nEOF",
    ]) {
      expect(guard(command).refused, command).toBe(false);
    }
  });

  it('refuses a test run inside `timeout`', () => {
    for (const command of [
      'timeout 600 pnpm test',
      'timeout -s KILL 60 pnpm verify',
      'cd x && timeout 60 pnpm --filter @vertex-mizan/db exec vitest run',
      'timeout 60 pnpm turbo run test',
    ]) {
      const result = guard(command);
      expect(result.refused, command).toBe(true);
      expect(result.message).toContain('timeout');
    }
  });

  it('refuses the whole E2E suite and lets specs and verify through', { timeout: 60_000 }, () => {
    for (const command of [
      'pnpm test:e2e',
      'pnpm --filter @vertex-mizan/web test:e2e',
      'pnpm --filter @vertex-mizan/web exec playwright test',
      'CI=1 pnpm exec playwright test --reporter=line',
    ]) {
      const result = guard(command);
      expect(result.refused, command).toBe(true);
      expect(result.message).toContain('pnpm verify --e2e-all');
    }
    for (const command of [
      'pnpm exec playwright test e2e/shell.spec.ts',
      'pnpm exec playwright test --grep "the shell"',
      'pnpm verify --e2e-all',
      'pnpm --silent verify apps/web/e2e/shell.spec.ts',
    ]) {
      expect(guard(command).refused, command).toBe(false);
    }
  });
});

describe('test guard: one run at a time', () => {
  it('lets a test run through when none is going', { timeout: 30_000 }, () => {
    expect(guard('pnpm verify').refused).toBe(false);
    expect(guard('pnpm test:scenarios').refused).toBe(false);
  });

  it('refuses a test run while a verify holds its lock', { timeout: 30_000 }, () => {
    writeFileSync(
      lockFile(),
      JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: repo }),
    );
    try {
      const result = guard('pnpm --filter @vertex-mizan/ledger test');
      expect(result.refused).toBe(true);
      expect(result.message).toContain('pnpm verify (pid');
    } finally {
      rmSync(lockFile(), { force: true });
    }
  });

  it('ignores a lock older than any run', { timeout: 30_000 }, () => {
    const since = new Date(Date.now() - 31 * 60_000).toISOString();
    writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, since, cwd: repo }));
    try {
      expect(guard('pnpm test').refused).toBe(false);
    } finally {
      rmSync(lockFile(), { force: true });
    }
  });

  it('refuses a test run while a Vitest process of the repository runs', {
    timeout: 30_000,
  }, async () => {
    // A process whose command line names the repository and Vitest, as a running suite's does.
    const running: ChildProcess = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 60_000)', join(repo, 'node_modules', 'vitest', 'vitest.mjs')],
      { stdio: 'ignore' },
    );
    try {
      await new Promise((ready) => running.once('spawn', ready));
      const result = guard('pnpm verify packages/db/test/roles.test.ts');
      expect(result.refused).toBe(true);
      expect(result.message).toContain(`(pid ${running.pid})`);
    } finally {
      running.kill();
    }
  });
});
