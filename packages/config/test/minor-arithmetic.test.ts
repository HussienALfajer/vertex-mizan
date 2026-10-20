import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The Biome plugin `biome-plugins/minor-arithmetic.grit` (ADR 0007): no arithmetic on `*Minor`
// fields outside packages/contracts and packages/ledger. Run with Biome on throwaway files in a
// project that loads only this plugin, as the root `biome.json` does.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const plugin = fileURLToPath(new URL('../biome-plugins/minor-arithmetic.grit', import.meta.url));
const biome = join(root, 'node_modules/@biomejs/biome/bin/biome');

let dir = '';
let count = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'minor-arithmetic-'));
  writeFileSync(
    join(dir, 'biome.json'),
    JSON.stringify({
      root: true,
      plugins: [plugin.replaceAll('\\', '/')],
      linter: { rules: { preset: 'none' } },
    }),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Lints `code` as a file under `folder`; returns the lines the plugin refused. */
function refusedLines(code: string, folder = 'apps/web/src'): number[] {
  const file = join(dir, folder, `case-${count++}.ts`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `const line = { amountMinor: 5n, rate: 2 };\nlet totalMinor = 0n;\n${code}\n`,
  );
  const result = spawnSync(process.execPath, [biome, 'lint', '--reporter=json', file], {
    cwd: dir,
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout) as {
    diagnostics: { category: string; location: { start: { line: number } } }[];
  };
  // Line numbers of the case itself, after the two declarations above.
  return report.diagnostics
    .filter((diagnostic) => diagnostic.category === 'plugin')
    .map((diagnostic) => diagnostic.location.start.line - 2);
}

describe('no arithmetic on *Minor fields', () => {
  it('refuses binary arithmetic with a *Minor operand on either side', () => {
    expect(
      refusedLines(
        [
          'export const a = line.amountMinor + 1n;',
          'export const b = 2n * totalMinor;',
          'export const c = (line.amountMinor) - 1n;',
          'export const d = Number(line.amountMinor) / 100;',
          'export const e = line.amountMinor % 2n;',
          'export const f = line.amountMinor ** 2n;',
        ].join('\n'),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('refuses compound assignment, increments and unary signs', () => {
    expect(
      refusedLines(
        [
          'totalMinor += 1n;',
          'totalMinor -= line.amountMinor;',
          'let count = 0;',
          'count += Number(line.amountMinor);',
          'totalMinor++;',
          '--totalMinor;',
          'export const g = -line.amountMinor;',
          'export const h = +totalMinor.toString();',
        ].join('\n'),
      ),
    ).toEqual([1, 2, 4, 5, 6, 7]);
  });

  it('allows comparisons, plain assignment and arithmetic on other fields', () => {
    expect(
      refusedLines(
        [
          'export const a = line.amountMinor > 0n;',
          'export const b = line.amountMinor === totalMinor;',
          'totalMinor = line.amountMinor;',
          'export const c = line.rate * 2;',
          'export const d = !line.amountMinor;',
          'export const e = { isMinor: true }.isMinor ? 1 : 0;',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('allows it inside packages/contracts and packages/ledger only', () => {
    const code = 'export const a = line.amountMinor + 1n;';
    expect(refusedLines(code, 'packages/contracts/src')).toEqual([]);
    expect(refusedLines(code, 'packages/ledger/src')).toEqual([]);
    expect(refusedLines(code, 'packages/db/src')).toEqual([1]);
    expect(refusedLines(code, 'apps/api/src')).toEqual([1]);
  });

  it('is loaded by the root biome.json', () => {
    const config = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as {
      plugins?: string[];
    };
    expect(config.plugins).toContain('./packages/config/biome-plugins/minor-arithmetic.grit');
  });
});
