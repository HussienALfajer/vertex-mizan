# packages/config

Shared TypeScript and Biome configuration for every app and package (ADR 0002), with the tests of the repository's own tooling. Copied from Vertex Food's `packages/config` and adapted.

## Layout
- `biome.json`: formatter and lint rules, extended by the root `biome.json` (which only sets the files to check: `docs/` is left out).
- `tsconfig/base.json`: strict compiler options for all code. `tsconfig/node.json`: Node ESM (`NodeNext`), for packages and Node apps. `tsconfig/react.json`: bundler resolution with the DOM and JSX, for `packages/ui` and the web app (copied from Vertex Food with PR 6, ADR 0010).
- `test/config.test.ts`: guards the settings that must never be loosened.
- `test/git-guard.test.ts`: the Claude Code hook `.claude/hooks/git-guard.mjs`, run with commands on stdin against throwaway repositories (commit on main, `commit -a`, `--no-verify`, broad `add`, pushes to main).
- `test/migration-guard.test.ts`: the migration guard `scripts/migration-guard.mjs` (ADR 0008), run on throwaway SQL files and fixture `packages/db` folders: every refused rule, dynamic SQL in function bodies, what a ledger migration legitimately creates, exceptions that name an ADR, changes to the append-only tables of a registry, and a `packages/db` with no migration, a nested one or no registry.
- `test/error-codes-guard.test.ts`: the error-code guard `scripts/error-codes-guard.mjs` (ADR 0006), run against throwaway repositories: appended codes pass; a removed, renamed, reordered, duplicated or re-statused code fails, and so does a line it cannot read.
- `biome-plugins/minor-arithmetic.grit`: a Biome GritQL plugin, loaded by the root `biome.json` (plugin paths resolve from the root config), that refuses arithmetic on `*Minor` fields outside `packages/contracts/src` and `packages/ledger/src` (ADR 0007). `test/minor-arithmetic.test.ts` runs it on throwaway files.
- `turbo.json` adds `.claude/hooks/`, `scripts/`, `docs/decisions/`, the table registry of `packages/db` (read by the migration guard) and the root `biome.json` to this package's test inputs, so a change there is never a cache hit.

## Rules
- A package's `tsconfig.json` extends one of these (`@vertex-mizan/config/tsconfig/node.json`) and adds only paths and output options.
- Never loosen `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` or a lint rule to make a check pass: fix the code. A rule that must differ for one app goes in an `overrides` entry in `biome.json`, with the reason.
- A new preset arrives with the first app that needs it (`nest.json` with `apps/api`, copied from Vertex Food), with an export in `package.json` and a test case.
- Versions are pinned exactly (ADR 0002). TypeScript stays on 6.0 (ADR 0008): TypeScript 7 ships no stable JavaScript API yet, which the NestJS and Drizzle tooling still load. Move to 7 in its own PR once they support it.
- The migration guard's rules only grow. Removing or loosening one needs an ADR, like any exception it allows.

Run: `pnpm --filter @vertex-mizan/config test`.
