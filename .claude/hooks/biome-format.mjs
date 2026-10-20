// PostToolUse hook (Edit|Write): format and lint-fix the edited file with Biome.
// Remaining diagnostics are sent back to Claude (exit code 2) so it fixes them in the next step.
// Copied from Vertex Food (.claude/hooks/biome-format.mjs). Does nothing until Biome is installed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
]);

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const filePath = input.tool_input?.file_path ?? input.tool_response?.filePath;

if (!filePath || !SUPPORTED.has(extname(filePath).toLowerCase())) process.exit(0);

const target = resolve(filePath);
const relativePath = relative(projectDir, target);
// On Windows a file on another drive has an absolute relative path, not one starting with `..`.
if (relativePath.startsWith('..') || isAbsolute(relativePath) || !existsSync(target)) {
  process.exit(0);
}

const biome = resolve(projectDir, 'node_modules/@biomejs/biome/bin/biome');
if (!existsSync(biome)) process.exit(0); // dependencies not installed yet

const result = spawnSync(
  process.execPath,
  [
    biome,
    'check',
    '--write',
    '--error-on-warnings',
    '--no-errors-on-unmatched',
    '--colors=off',
    relativePath,
  ],
  { cwd: projectDir, encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(
    `Biome found problems in ${relativePath}:\n${result.stdout}${result.stderr}`,
  );
  process.exit(2);
}
