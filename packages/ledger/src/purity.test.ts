import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The package stays pure (ADR 0005, ADR 0007): no I/O, no clock, no randomness. Its code imports
 * only the money module and its own files; `integrity.ts` alone imports `node:crypto`. Tests may
 * use Node freely.
 */
const directory = new URL('./', import.meta.url);
const sources = readdirSync(directory).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'test-fixtures.ts',
);

describe('packages/ledger', () => {
  it('has source files to check', () => {
    expect(sources).toContain('balance.ts');
  });

  it.each(sources)('%s imports only the money module and its own files', (file) => {
    const text = readFileSync(new URL(file, directory), 'utf8');
    const imports = [...text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(?\s*'([^']+)'/g)].map(
      (match) => match[1] ?? match[2],
    );
    const allowed = (specifier: string | undefined) =>
      specifier === '@vertex-mizan/contracts' ||
      /^\.\/[\w-]+\.js$/.test(specifier ?? '') ||
      (file === 'integrity.ts' && specifier === 'node:crypto');
    expect(imports.filter((specifier) => !allowed(specifier))).toEqual([]);
    expect(text).not.toMatch(
      /\b(process\.|fetch\(|setTimeout\(|Date\.now\(|Math\.random\(|new Date\()/,
    );
  });
});
