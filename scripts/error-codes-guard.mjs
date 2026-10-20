// The error-code guard (ADR 0006: stable error codes, never renamed, removed or reused). Compares
// `errorStatus` in `packages/contracts/src/errors.ts` with the same file at a base commit (CI passes
// the pull request's base) and fails unless the base's codes are still there, first, in the same
// order and with the same HTTP status. New codes may only be appended. Run by CI
// (`pnpm check:error-codes --base <ref>`); tested by `packages/config/test/error-codes-guard.test.ts`.
//
// Options: `--base <ref>` (default `origin/main`), `--repo <dir>` (default this repository) and
// `--file <path in the repository>` (default the registry above).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = /^([A-Z][A-Z0-9_]*): ([1-5]\d\d),$/;

/** The `[code, status]` entries of `errorStatus`; throws on any line it does not recognise. */
export function parseRegistry(source) {
  const start = source.indexOf('export const errorStatus = {');
  const end = source.indexOf('} as const', start);
  if (start === -1 || end === -1) throw new Error('no `export const errorStatus = { … } as const`');
  const body = source.slice(source.indexOf('{', start) + 1, end);
  const entries = [];
  let comment = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (comment) {
      comment = !line.includes('*/');
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      comment = !line.includes('*/');
      continue;
    }
    const match = ENTRY.exec(line);
    if (!match) throw new Error(`unrecognised line in errorStatus: ${line}`);
    entries.push([match[1], Number(match[2])]);
  }
  return entries;
}

/** The problems that make `head` break the codes published in `base`. */
export function compareRegistries(base, head) {
  const problems = [];
  base.forEach(([code, status], index) => {
    const now = head[index];
    if (!now) problems.push(`${code} was removed`);
    else if (now[0] !== code)
      problems.push(`${code} was renamed, removed or moved (now ${now[0]})`);
    else if (now[1] !== status) problems.push(`${code} changed status from ${status} to ${now[1]}`);
  });
  const seen = new Set();
  for (const [code] of head) {
    if (seen.has(code)) problems.push(`${code} appears twice`);
    seen.add(code);
  }
  return problems;
}

function option(args, name, fallback) {
  const index = args.lastIndexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function main(args) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const repo = resolve(option(args, '--repo', root));
  const base = option(args, '--base', 'origin/main');
  const file = option(args, '--file', 'packages/contracts/src/errors.ts');
  const git = (...gitArgs) =>
    execFileSync('git', ['-C', repo, ...gitArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    console.error(`error-codes-guard: base ${base} is not a commit here; fetch it first`);
    return 2;
  }
  let baseSource;
  try {
    baseSource = git('show', `${base}:${file}`);
  } catch {
    console.warn(`error-codes-guard: ${file} does not exist at ${base}; nothing published yet`);
    return 0;
  }
  try {
    const problems = compareRegistries(
      parseRegistry(baseSource),
      parseRegistry(readFileSync(join(repo, file), 'utf8')),
    );
    for (const problem of problems) console.error(`error-codes-guard: ${problem}`);
    if (problems.length > 0) {
      console.error(
        'Error codes are never renamed, removed or reused (ADR 0006): append new ones.',
      );
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`error-codes-guard: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
