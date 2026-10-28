// PreToolUse hook (Bash and PowerShell): refuse `git commit` on main, `git commit -a`, skipping git
// hooks (`--no-verify`), pushing to main, and broad staging (`git add -A`, `--all`, `-u`, `.`,
// `:/`). A refusal exits with code 2; the message goes back to Claude, which must use a branch,
// push its own branch, or stage by path. Copied from Vertex Food (.claude/hooks/git-guard.mjs),
// with the `commit -a` and `--no-verify` rules kept from Mizan's first version.
// Tested by `packages/config/test/git-guard.test.ts`, which pipes commands into this file.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = input.tool_input?.command ?? '';

// Global options of `git` that take the next word as their value (`git -C dir commit`).
const OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);
// Options of `git commit` that take the next word as their value, so a message such as
// `-m "-a"` is not read as a flag or a path.
const COMMIT_OPTIONS_WITH_VALUE = new Set([
  '-m',
  '-F',
  '-C',
  '-c',
  '-t',
  '--message',
  '--file',
  '--author',
  '--date',
  '--fixup',
  '--squash',
  '--reuse-message',
  '--reedit-message',
  '--trailer',
  '--cleanup',
  '--template',
]);
// Options of `git push` that take the next word as their value, so it is not read as the remote.
const PUSH_OPTIONS_WITH_VALUE = new Set([
  '-o',
  '--push-option',
  '--repo',
  '--receive-pack',
  '--exec',
]);
// Flags after which a shell takes a script (`bash -c`, `sh -lc`, `pwsh -Command`, `cmd /c`).
const SCRIPT_FLAGS = new Set(['-c', '-lc', '-ic', '-Command', '-command', '/c', '/C']);
// Flags of `gh` whose value is prose (a pull request's title or body), never a script.
const TEXT_FLAGS = new Set(['--title', '-t', '--body', '-b']);
// Pathspecs that stage the whole tree.
const WHOLE_TREE = new Set(['.', './', '*', ':', ':/', ':/.', ':/*']);

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function currentBranch(dir) {
  const result = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** Splits a command line into parts, outside quotes: `&&`, `||`, `|`, `;`, `&`, `(`, `)`, newline. */
function splitChain(line) {
  const parts = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '\\' && i + 1 < line.length) {
      current += char + line[++i];
    } else if (';&|()\n'.includes(char)) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Shell-like words with quotes removed (`"."` → `.`); `$(…)` and backticks are left as text. */
function words(part) {
  const result = [];
  let current = '';
  let started = false;
  let quote = '';
  for (let i = 0; i < part.length; i++) {
    const char = part[i];
    if (quote) {
      if (char === quote) quote = '';
      // Inside double quotes a backslash escapes only `"`, `\`, `$` and a backtick, as in bash, so
      // a Windows path keeps its backslashes.
      else if (char === '\\' && quote === '"' && '"\\$`'.includes(part[i + 1] ?? ''))
        current += part[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && i + 1 < part.length) {
      current += part[++i];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) result.push(current);
  return result;
}

const isGit = (word) => /(^|[\\/])git(\.exe)?$/i.test(word.replace(/^[(`]|^\$\(/, ''));

/**
 * A pushed refspec that can update `main`: `main`, `+main`, `HEAD:main`, `:main`, `heads/main`,
 * `refs/heads/main`, a glob (`refs/heads/*`) or the matching refspec (`:`, `+:`).
 */
function targetsMain(refspec) {
  const destination = refspec.replace(/^\+/, '').split(':').pop() ?? '';
  return (
    destination === '' ||
    destination.includes('*') ||
    destination === 'main' ||
    destination.endsWith('/main')
  );
}

/** The words of a subcommand, without the values of the options that take one (`-m <message>`). */
function withoutValues(rest, optionsWithValue) {
  return rest.filter((_, index) => !optionsWithValue.has(rest[index - 1] ?? ''));
}

/**
 * The words without shell redirections (`2>`, `>/dev/null`, `<<EOF`), which are not arguments of
 * the command; a bare operator also takes its target, the next word. The value of an option that
 * takes one (`-m "<draft>"`) is never read as a redirection.
 */
function withoutRedirections(args, optionsWithValue) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const redirection = /^\d*(?:>>?|<<?<?|&>>?)(.*)$/.exec(args[i]);
    if (!redirection || optionsWithValue.has(args[i - 1] ?? '')) result.push(args[i]);
    else if (redirection[1] === '') i++;
  }
  return result;
}

function checkGit(args) {
  let dir = projectDir;
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const option = args[index];
    if (OPTIONS_WITH_VALUE.has(option)) {
      if (option === '-C' && args[index + 1]) {
        const value = args[index + 1];
        dir = isAbsolute(value) ? value : resolve(dir, value);
      }
      index += 2;
    } else {
      if (option.startsWith('-C') && option.length > 2) dir = resolve(dir, option.slice(2));
      index += 1;
    }
  }
  const subcommand = args[index];
  const valueOptions =
    subcommand === 'commit'
      ? COMMIT_OPTIONS_WITH_VALUE
      : subcommand === 'push'
        ? PUSH_OPTIONS_WITH_VALUE
        : new Set();
  const rest = withoutRedirections(args.slice(index + 1), valueOptions);
  const used = subcommand === 'commit' ? withoutValues(rest, COMMIT_OPTIONS_WITH_VALUE) : rest;
  const flags = used.filter((arg) => arg.startsWith('-'));

  // `-n` is `--no-verify` for `git commit` only (for `git push` it is a dry run).
  if (
    flags.includes('--no-verify') ||
    (subcommand === 'commit' && flags.some((arg) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(arg)))
  ) {
    refuse(
      'Refused: never skip git hooks with `--no-verify` (AGENTS.md, Git). Fix what the hook reports instead.',
    );
  }

  if (subcommand === 'commit') {
    if (currentBranch(dir) === 'main') {
      refuse(
        'Refused: never commit to main (AGENTS.md, Git). Create a branch named by type first, e.g. `git switch -c feat/<topic>`.',
      );
    }
    // `-a`, `-am` and other bundles with `a`, or `--all`, commit every tracked change. Paths on
    // the command line (`git commit .`, `:!README.md`, `--pathspec-from-file`) bypass staging:
    // the only flow is to stage by path, then commit what is staged.
    if (
      flags.some(
        (arg) =>
          arg === '--all' ||
          /^-[a-zA-Z]*a[a-zA-Z]*$/.test(arg) ||
          arg.startsWith('--pathspec-from-file'),
      ) ||
      used.some((arg) => arg === '--' || !arg.startsWith('-'))
    ) {
      refuse(
        'Refused: never `git commit -a`, `--all` or paths on `git commit` (AGENTS.md, Git). Stage the intended files by path, then commit.',
      );
    }
  }

  if (subcommand === 'add') {
    const broad = rest.some(
      (arg) =>
        arg === '--all' ||
        arg === '--update' ||
        arg === '--no-ignore-removal' ||
        /^-[a-zA-Z]*[Au][a-zA-Z]*$/.test(arg) ||
        WHOLE_TREE.has(arg),
    );
    if (broad) {
      refuse(
        'Refused: stage files by path, never `git add -A`, `--all`, `-u`, `.` or `:/` (AGENTS.md, Git). Check `git status` and add the intended files.',
      );
    }
  }

  if (subcommand === 'push') {
    const pushWords = withoutValues(rest, PUSH_OPTIONS_WITH_VALUE);
    const pushFlags = pushWords.filter((arg) => arg.startsWith('-'));
    const positional = pushWords.filter((arg) => !arg.startsWith('-'));
    const refspecs = positional.slice(1);
    // `HEAD` and `@` without a destination push the current branch to its own name.
    const pushesCurrent =
      refspecs.length === 0 || refspecs.some((r) => ['HEAD', '@', '+HEAD', '+@'].includes(r));
    const pushesMain =
      pushFlags.includes('--all') ||
      pushFlags.includes('--branches') ||
      pushFlags.includes('--mirror') ||
      refspecs.some(targetsMain) ||
      (pushesCurrent && currentBranch(dir) === 'main');
    if (pushesMain) {
      refuse(
        'Refused: never push main (AGENTS.md, Git). Push your own branch (`git push -u origin <branch>`) and open a pull request.',
      );
    }
  }
}

function check(line, depth = 0) {
  for (const part of splitChain(line)) {
    const parts = words(part);
    // The first `git` word is the command (`git …`, `env X=1 git …`); later ones are arguments.
    const gitIndex = parts.findIndex(isGit);
    if (gitIndex >= 0) {
      checkGit(parts.slice(gitIndex + 1));
      continue;
    }
    // A script run by a shell (`bash -c "git commit …"`, `pwsh -Command "…"`, `eval "…"`) is
    // checked too: a word after a script flag, or any quoted word that could hold a command. Prose
    // given to `gh` (`--title`, `--body`) is text, not a script, even when it mentions git.
    parts.forEach((word, index) => {
      const previous = parts[index - 1] ?? '';
      if (TEXT_FLAGS.has(previous) || /^--(?:title|body)=/.test(word)) return;
      const script = SCRIPT_FLAGS.has(previous) || /[\s;&|()`'"]/.test(word);
      if (depth < 2 && script) check(word, depth + 1);
    });
  }
}

check(command);
