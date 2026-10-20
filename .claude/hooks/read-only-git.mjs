// PreToolUse hook (Bash) for the reviewer subagents: allow only read-only git commands
// (`git diff`, `log`, `show`, `status`, `rev-parse`, `branch --list`, `ls-files`, `merge-base`).
// Anything else, or any chaining, redirection or substitution, is refused with exit code 2.
// A coarse filter, not a security boundary: the settings' deny rules still apply.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = (input.tool_input?.command ?? '').trim();

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (/[;&|<>`\n]|\$\(/.test(command)) {
  refuse('Refused: reviewers run one read-only git command at a time, with no chaining, pipes, redirection or substitution.');
}

const allowed =
  /^git(\s+-C\s+\S+)?\s+(diff|log|show|status|rev-parse|ls-files|merge-base|branch\s+(--list|-l|-a|--all|--show-current))(\s|$)/;
if (!allowed.test(command)) {
  refuse(
    'Refused: reviewers may only run read-only git commands (diff, log, show, status, rev-parse, ls-files, merge-base, branch --list).',
  );
}
