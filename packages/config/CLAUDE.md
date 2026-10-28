# packages/config

Shared TypeScript and Biome configuration for every app and package (ADR 0002), with the tests of the repository's own tooling. Copied from Vertex Food's `packages/config` and adapted.

## Layout
- `biome.json`: formatter and lint rules, extended by the root `biome.json` (which only sets the files to check: `docs/` is left out).
- `tsconfig/base.json`: strict compiler options for all code. `tsconfig/node.json`: Node ESM (`NodeNext`), for packages and Node apps. `tsconfig/react.json`: bundler resolution with the DOM and JSX, for `packages/ui` and the web app (copied from Vertex Food with the design system, ADR 0010).
- `tsconfig/nest.json`: `node.json` with legacy decorators and no decorator metadata, for `apps/api` and `apps/worker` (copied from Vertex Food with the API and worker skeletons, #17): injection is explicit (`@Inject(token)`), so the build and Vitest behave the same.
- `biome.json` `overrides` for `apps/api` and `apps/worker`: parameter decorators parse (`@Inject` in constructors), and `noStaticOnlyClass` is off (a Nest module class holds only `forRoot`).
- `test/config.test.ts`: guards the settings that must never be loosened.
- `test/git-guard.test.ts`: the Claude Code hook `.claude/hooks/git-guard.mjs`, run with commands on stdin against throwaway repositories (commit on main, `commit -a`, `--no-verify`, broad `add`, pushes to main), in Bash and PowerShell syntax (script blocks, here-strings, backslash paths): the hook runs on both tools, and refuses a commit or push in a directory whose branch it cannot read.
- `test/test-guard.test.ts`: the Claude Code hook `.claude/hooks/test-guard.mjs`, a copy run in a throwaway repository with its own temporary folder: commands that run no tests pass; `timeout` around a test run and the whole E2E suite are refused; a test run is refused while a verify lock (not an expired one) or a Vitest process of the repository is there.
- `test/migration-guard.test.ts`: the migration guard `scripts/migration-guard.mjs` (ADR 0008), run on throwaway SQL files and fixture `packages/db` folders: every refused rule, dynamic SQL in function bodies, what a ledger migration legitimately creates, exceptions that name an ADR, changes to the append-only tables of a registry, and a `packages/db` with no migration, a nested one or no registry.
- `test/error-codes-guard.test.ts`: the error-code guard `scripts/error-codes-guard.mjs` (ADR 0006), run against throwaway repositories: appended codes pass; a removed, renamed, reordered, duplicated or re-statused code fails, and so does a line it cannot read.
- `test/openapi-guard.test.ts`: the OpenAPI guard `scripts/openapi-guard.mjs` (ADR 0006), run against throwaway repositories with oasdiff: nothing published, unchanged and additive documents pass, a value added to an enum in an answer too (lowered to `info`, owner 2026-10-27), while a removed one fails (raised from `info`); a removed route, a lost required or optional field, a removed error answer or `operationId`, or a removed document fails (the `info` checks raised by `scripts/oasdiff-severity-levels.txt`); a missing oasdiff fails. The oasdiff cases run where the pinned oasdiff is installed (`node scripts/tools.mjs install`, which `pnpm verify` and CI run), on the PATH or named by `OASDIFF`, and always in CI.
- `test/ci.test.ts`: the versions CI pins outside the lockfile stay equal to the repository's: the Playwright image of the E2E jobs and `@playwright/test` in `apps/web`, the secret scan's gitleaks and `scripts/tools.mjs`.
- `biome-plugins/minor-arithmetic.grit`: a Biome GritQL plugin, loaded by the root `biome.json` (plugin paths resolve from the root config), that refuses arithmetic on `*Minor` fields outside `packages/contracts/src` and `packages/ledger/src` (ADR 0007). `test/minor-arithmetic.test.ts` runs it on throwaway files.
- `turbo.json` adds `.claude/hooks/`, `scripts/`, `docs/decisions/`, the table registry of `packages/db` (read by the migration guard), the root `biome.json`, `.github/workflows/` and `apps/web/package.json` (read by `ci.test.ts`) to this package's test inputs, so a change there is never a cache hit.

## Rules
- A package's `tsconfig.json` extends one of these (`@vertex-mizan/config/tsconfig/node.json`) and adds only paths and output options.
- Never loosen `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` or a lint rule to make a check pass: fix the code. A rule that must differ for one app goes in an `overrides` entry in `biome.json`, with the reason.
- A new preset arrives with the first app that needs it (as `nest.json` came with `apps/api`, copied from Vertex Food), with an export in `package.json` and a test case.
- Versions are pinned exactly (ADR 0002). TypeScript stays on 6.0 (ADR 0008): TypeScript 7 ships no stable JavaScript API yet, which the NestJS and Drizzle tooling still load. Move to 7 in its own PR once they support it.
- The migration guard's rules only grow. Removing or loosening one needs an ADR, like any exception it allows.

Run: `pnpm --filter @vertex-mizan/config test`.
