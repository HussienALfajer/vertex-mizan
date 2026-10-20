import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The Claude Code hook `.claude/hooks/git-guard.mjs`, run as Claude Code runs it: the Bash tool's
// input as JSON on stdin; exit code 2 refuses the command.
const hook = fileURLToPath(new URL('../../../.claude/hooks/git-guard.mjs', import.meta.url));

function git(dir: string, ...args: string[]) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

/** A throwaway repository with one commit, on `branch`. */
function repository(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-guard-'));
  git(dir, 'init', '--quiet', '--initial-branch', branch);
  git(
    dir,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'init',
  );
  return dir;
}

function refused(command: string): boolean {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
  if (result.status !== 0 && result.status !== 2) throw new Error(result.stderr);
  return result.status === 2;
}

let main = '';
let feature = '';

beforeAll(() => {
  main = repository('main');
  feature = repository('feat/topic');
});

afterAll(() => {
  rmSync(main, { recursive: true, force: true });
  rmSync(feature, { recursive: true, force: true });
});

describe('git guard: commits', () => {
  it('refuses a commit on main, however git is called', () => {
    for (const command of [
      `git -C "${main}" commit -m "x"`,
      `git -c core.quotepath=false -C "${main}" commit -m x`,
      `git --no-pager -C "${main}" commit -m x`,
      `cd x && git -C '${main}' commit -m x`,
      `bash -c "git -C '${main}' commit -m x"`,
      `env GIT_TRACE=0 git -C "${main}" commit -m x`,
      `eval "git -C '${main}' commit -m x"`,
      `pwsh -NoProfile "git -C '${main}' commit -m x"`,
    ]) {
      expect(refused(command), command).toBe(true);
    }
  });

  it('allows a commit on a branch, and a message that mentions git commands', () => {
    expect(refused(`git -C "${feature}" commit -m "fix: run git add . less"`)).toBe(false);
    expect(refused(`git -C "${feature}" commit -m "a; git add -A"`)).toBe(false);
    expect(refused(`git -C "${feature}" commit -m "-a is refused"`)).toBe(false);
    expect(refused(`git -C "${feature}" commit --amend --no-edit`)).toBe(false);
    expect(refused(`git -C "${feature}" commit --author "A B <a@b.test>" -m x`)).toBe(false);
    expect(refused(`git -C "${feature}" commit -F message.txt`)).toBe(false);
  });

  it.each([
    'commit -a -m x',
    'commit -am x',
    'commit --all -m x',
    'commit -sam x',
    'commit .',
    'commit -m x -- .',
    'commit -i .',
    "commit -m x ':!README.md'",
    "commit -m x ':(top)'",
    'commit -m x D:/vertex-mizan',
    'commit -m x --pathspec-from-file=-',
  ])('refuses git %s on a branch', (args) => {
    expect(refused(`git -C "${feature}" ${args}`)).toBe(true);
  });
});

describe('git guard: wrapped commands', () => {
  it.each([
    'eval "git add -A"',
    'powershell "git commit --no-verify -m x"',
    'pwsh -NoProfile "git commit -am x"',
    'eval "true;git commit -a -m x"',
    'eval "(git push origin main)"',
    'eval "/usr/bin/git add -A"',
    `powershell "& 'git' commit --no-verify -m x"`,
    'powershell "git.exe push origin main"',
    'echo $(git add -A)',
  ])('refuses %s', (command) => {
    expect(refused(command)).toBe(true);
  });
});

describe('git guard: hooks', () => {
  it.each([
    'commit --no-verify -m x',
    'commit -n -m x',
    'commit -nm x',
    'push --no-verify -u origin feat/topic',
  ])('refuses git %s', (args) => {
    expect(refused(`git -C "${feature}" ${args}`)).toBe(true);
  });

  it('allows a dry-run push, whose -n is not --no-verify', () => {
    expect(refused(`git -C "${feature}" push -n origin feat/topic`)).toBe(false);
  });
});

describe('git guard: staging', () => {
  it.each([
    'git add -A',
    'git add --all',
    'git add -u',
    'git add --update',
    'git add -Af',
    'git add -vA',
    'git add .',
    'git add "."',
    "git add '.'",
    'git add ./',
    'git add :/',
    'git add -- .',
    'git -c core.autocrlf=false add .',
    'git status && git add -A',
  ])('refuses %s', (command) => {
    expect(refused(command)).toBe(true);
  });

  it.each([
    'git add apps/api/src/app.ts',
    'git add -- "docs/audits/a file.md"',
    'git add -p apps/api/src/app.ts',
    'git status',
    'pnpm lint',
  ])('allows %s', (command) => {
    expect(refused(command)).toBe(false);
  });
});

describe('git guard: pushes', () => {
  it.each([
    'git push origin main',
    'git push -u origin main',
    'git push origin HEAD:main',
    'git push origin +main',
    'git push origin feat/x:main',
    'git push origin refs/heads/main',
    'git push origin :main',
    'git push --all origin',
    'git push --mirror origin',
    'git push --branches origin',
    "git push origin 'refs/heads/*'",
    'git push origin refs/heads/*:refs/heads/*',
    'git push origin :',
    'git push origin +:',
    'git push origin heads/main',
  ])('refuses %s', (command) => {
    expect(refused(command)).toBe(true);
  });

  it('refuses a push of the current branch from main, allows one from a branch', () => {
    for (const args of [
      'push',
      'push -u origin',
      'push -u origin HEAD',
      'push origin @',
      'push -o ci.skip origin',
      'push --push-option ci.skip origin HEAD',
    ]) {
      expect(refused(`git -C "${main}" ${args}`), args).toBe(true);
      expect(refused(`git -C "${feature}" ${args}`), args).toBe(false);
    }
  });

  it.each(['git push -u origin fix/audit-tooling-docs', 'git push origin feat/main-menu'])(
    'allows %s',
    (command) => {
      expect(refused(command)).toBe(false);
    },
  );
});
