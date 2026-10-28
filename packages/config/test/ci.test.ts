import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The versions CI pins outside a lockfile, kept equal to the ones the repository uses: Dependabot
// updates @playwright/test but not the image the E2E jobs run in, and the image only carries the
// browsers of its own Playwright release.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/ci.yml');

describe('CI pins', () => {
  it('runs E2E in the Playwright image of the version apps/web uses', () => {
    const { devDependencies } = JSON.parse(read('apps/web/package.json'));
    const image = workflow.match(/image: mcr\.microsoft\.com\/playwright:v([\d.]+)-noble@sha256:/);
    expect(image?.[1]).toBe(devDependencies['@playwright/test']);
  });

  it('scans for secrets with the gitleaks release pnpm verify runs', () => {
    const pinned = read('scripts/tools.mjs').match(/gitleaks: \{\s*version: '([\d.]+)'/);
    expect(workflow).toContain(`GITLEAKS_VERSION: ${pinned?.[1]}`);
  });
});
