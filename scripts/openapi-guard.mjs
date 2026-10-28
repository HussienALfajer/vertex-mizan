// The OpenAPI breaking-change guard (ADR 0006: `/v1` changes are additive only; CI fails on a
// breaking change to the published document). Compares `apps/api/openapi.json` with the same file
// at a base commit (CI passes the pull request's base) through oasdiff, and fails on any change
// oasdiff reports as breaking, warnings included. That the committed file matches the API is
// checked by `apps/api/test/openapi.test.ts`. Run by CI (`pnpm check:openapi --base <ref>`); tested
// by `packages/config/test/openapi-guard.test.ts`.
//
// oasdiff reports some changes that break a client only as `info`; `oasdiff-severity-levels.txt`
// (which cannot hold comments) raises them to errors: a documented error answer removed (Hub tells
// `409 IDEMPOTENCY_CONFLICT` from a posting), an optional response field removed (Hub reads it when
// present), an `operationId` or a component schema removed (generated clients and the JSON Schemas
// Hub imports name them), and a route removed even after its deprecation (ADR 0006: `/v1` only
// grows; a change of meaning is a new version). It also lowers one warning to `info`: a value added
// to an enum in an answer (an error code, an audit action, an event type appended to its list).
// ADR 0006 counts that as additive, and clients accept values they do not know (owner,
// 2026-10-27). A value removed from such an enum fails: oasdiff reports it only as `info`, so it is
// raised to an error with the others above.
//
// Needs the oasdiff binary: the pinned release `node scripts/tools.mjs install oasdiff` puts in
// .tools/ (CI and `pnpm verify` install it), the one `OASDIFF` names, or one on the PATH.
//
// Options: `--base <ref>` (default `origin/main`), `--repo <dir>` (default this repository) and
// `--file <path in the repository>` (default the document above).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolPath } from './tools.mjs';

function option(args, name, fallback) {
  const index = args.lastIndexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function main(args) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const repo = resolve(option(args, '--repo', root));
  const base = option(args, '--base', 'origin/main');
  const file = option(args, '--file', 'apps/api/openapi.json');
  const oasdiff = toolPath('oasdiff') ?? 'oasdiff';
  const git = (...gitArgs) =>
    execFileSync('git', ['-C', repo, ...gitArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    console.error(`openapi-guard: base ${base} is not a commit here; fetch it first`);
    return 2;
  }
  let baseDocument;
  try {
    baseDocument = git('show', `${base}:${file}`);
  } catch {
    console.warn(`openapi-guard: ${file} does not exist at ${base}; nothing published yet`);
    return 0;
  }
  const head = join(repo, file);
  if (!existsSync(head)) {
    console.error(`openapi-guard: ${file} was removed; the published API cannot disappear`);
    return 1;
  }

  const dir = mkdtempSync(join(tmpdir(), 'openapi-guard-'));
  try {
    const published = join(dir, 'base.json');
    writeFileSync(published, baseDocument);
    const result = spawnSync(
      oasdiff,
      [
        'breaking',
        published,
        head,
        '--fail-on',
        'WARN',
        '--severity-levels',
        fileURLToPath(new URL('oasdiff-severity-levels.txt', import.meta.url)),
        '--format',
        'text',
      ],
      { encoding: 'utf8' },
    );
    if (result.error) {
      console.error(
        `openapi-guard: cannot run ${oasdiff} (${result.error.code ?? result.error.message}). ` +
          'Install the pinned oasdiff with `node scripts/tools.mjs install oasdiff`, or set OASDIFF.',
      );
      return 2;
    }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) {
      console.error(
        `openapi-guard: ${file} breaks the API published at ${base}. The published API changes ` +
          'additively only (ADR 0006): add a field, a route or a version instead.',
      );
      return 1;
    }
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
