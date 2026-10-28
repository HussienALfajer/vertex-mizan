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
  // One hook run per case: each run spawns Node and git, and a loop of them inside one test
  // outgrew Vitest's 5 s timeout when `pnpm verify` ran every package at once.
  // `$repo` is replaced by the throwaway repository, which exists only once `beforeAll` has run.
  it.each([
    'git -C "$repo" commit -m "x"',
    'git -c core.quotepath=false -C "$repo" commit -m x',
    'git --no-pager -C "$repo" commit -m x',
    "cd x && git -C '$repo' commit -m x",
    `bash -c "git -C '$repo' commit -m x"`,
    'env GIT_TRACE=0 git -C "$repo" commit -m x',
    `eval "git -C '$repo' commit -m x"`,
    `pwsh -NoProfile "git -C '$repo' commit -m x"`,
  ])('refuses a commit on main: %s', (command) => {
    expect(refused(command.replace('$repo', main))).toBe(true);
  });

  it.each([
    'git -C "$repo" commit -m "fix: run git add . less"',
    'git -C "$repo" commit -m "a; git add -A"',
    'git -C "$repo" commit -m "-a is refused"',
    'git -C "$repo" commit --amend --no-edit',
    'git -C "$repo" commit --author "A B <a@b.test>" -m x',
    'git -C "$repo" commit -F message.txt',
    'git -C "$repo" commit -m "<draft>"',
  ])('allows a commit on a branch, with a message that mentions git commands: %s', (command) => {
    expect(refused(command.replace('$repo', feature))).toBe(false);
  });

  it.each([
    'commit -m "fix: x" 2>&1',
    'commit -m "fix: x" 2>&1 | tail -3',
    'commit -F message.txt >/dev/null',
    'commit -F message.txt 2> err.txt',
    "commit -F - <<'EOF'",
  ])('allows git %s on a branch: redirections are not paths', (args) => {
    expect(refused(`git -C "${feature}" ${args}`)).toBe(false);
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

describe('git guard: prose given to gh', () => {
  it.each([
    'gh pr create --title "x" --body "the guard refuses git commit -a, broad staging and git push origin main"',
    'gh pr create -t "x" -b "stage by path, never git add -A"',
    'gh pr create --title "x" --body="never git add -A"',
    'gh pr create --title "x" --body-file pr-body.md',
  ])('allows %s', (command) => {
    expect(refused(command)).toBe(false);
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

// The PowerShell tool's commands reach the same hook: statements joined with `;` and `if ($?) { }`,
// and messages in single-quoted here-strings.
describe('git guard: PowerShell commands', () => {
  it.each([
    'git add -A; if ($?) { git commit -m x }',
    'if ($?) { git push origin main }',
    'git push origin main --force-with-lease; $LASTEXITCODE',
  ])('refuses %s', (command) => {
    expect(refused(command)).toBe(true);
  });

  it('refuses a here-string commit on main, allows it on a branch', () => {
    const commit = (dir: string) => `git -C "${dir}" commit -m @'\nfeat: x\n\nWhy.\n'@`;
    expect(refused(commit(main))).toBe(true);
    expect(refused(commit(feature))).toBe(false);
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

  it.each([
    'push',
    'push -u origin',
    'push -u origin HEAD',
    'push origin @',
    'push -o ci.skip origin',
    'push --push-option ci.skip origin HEAD',
    'push origin 2>&1',
  ])('refuses git %s of the current branch from main, allows it from a branch', (args) => {
    expect(refused(`git -C "${main}" ${args}`)).toBe(true);
    expect(refused(`git -C "${feature}" ${args}`)).toBe(false);
  });

  it.each(['git push -u origin fix/audit-tooling-docs', 'git push origin feat/main-menu'])(
    'allows %s',
    (command) => {
      expect(refused(command)).toBe(false);
    },
  );
});
