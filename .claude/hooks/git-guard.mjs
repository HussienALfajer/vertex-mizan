// PreToolUse hook (Bash): refuse `git commit` on main and broad staging (`git add -A`, `--all`, `.`).
// Copied from Vertex Food (.claude/hooks/git-guard.mjs).
// A refusal exits with code 2; the message goes back to Claude, which must use a branch or stage by path.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = input.tool_input?.command ?? '';

// Split chained commands so each git invocation is checked on its own.
const parts = command.split(/&&|\|\||;|\n/);

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

for (const part of parts) {
  if (/\bgit\b/.test(part) && /\s--no-verify\b/.test(` ${part} `)) {
    refuse(
      'Refused: never skip git hooks with `--no-verify` (AGENTS.md, Git). Fix what the hook reports instead.',
    );
  }

  const match = part.match(/\bgit\b((?:\s+-C\s+("[^"]+"|'[^']+'|\S+))?)\s+(commit|add)\b(.*)$/);
  if (!match) continue;
  const dirArg = match[2]?.replace(/^["']|["']$/g, '');
  const subcommand = match[3];
  const rest = ` ${match[4] ?? ''} `;

  if (subcommand === 'commit') {
    const branch = currentBranch(dirArg ? resolve(projectDir, dirArg) : projectDir);
    if (branch === 'main') {
      refuse(
        'Refused: never commit to main (AGENTS.md, Git). Create a branch named by type first, e.g. `git switch -c feat/<topic>`.',
      );
    }
    // `-a`, `-am` and other bundles with `a`, or `--all`, stage every tracked change.
    if (/\s(-[a-zA-Z]*a[a-zA-Z]*|--all)\s/.test(rest)) {
      refuse(
        'Refused: never `git commit -a` / `-am` / `--all` (AGENTS.md, Git). Stage the intended files by path, then commit.',
      );
    }
  }

  if (
    subcommand === 'add' &&
    /\s(-[a-zA-Z]*[Au][a-zA-Z]*|--all|--update|\.\/?|:\/\S*)\s/.test(rest)
  ) {
    refuse(
      'Refused: stage files by path, never `git add -A`, `--all`, `-u`, `.`, `./` or `:/` (AGENTS.md, Git). Check `git status` and add the intended files.',
    );
  }
}
