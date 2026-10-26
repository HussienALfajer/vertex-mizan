# apps/api

NestJS 12 HTTP API with the Express adapter, a modular monolith (ADR 0002). Toolchain copied from Vertex Food's `apps/api` (plain `tsc`, no decorator metadata); logging, Standard Schema validation, the OpenAPI document and the health check follow Vertex Hub's `apps/api`. Phase 0 holds the core only; the first module arrives with S01.

## Layout
- `src/main.ts`: loads the config from the environment, builds the app, listens on `API_HOST:API_PORT` (default `127.0.0.1:3300`).
- `src/app.module.ts`: `AppModule.forRoot(config)`: config, nestjs-pino, the database, the global `StandardSchemaValidationPipe` and `StandardSchemaSerializerInterceptor`, then the modules.
- `src/app.ts`: `configureApp(app, config)` (logger, `/api` prefix, no `x-powered-by`, shutdown hooks, Swagger UI at `/api/docs` outside production) and `createOpenApiDocument(app)`. Production and the tests both go through it.
- `src/core/config/`: `loadConfig(env)` (Zod; errors name the variable, never its value) and `ConfigModule` (`CONFIG` token).
- `src/core/database/`: `DatabaseModule`, one pool as `mizan_app` through `createDatabase` (`DATABASE` token), closed on shutdown. It connects on first use.
- `src/core/health/`: `GET /api/health` with `healthResponseSchema` from contracts: 200 when the database answers `select 1`, 503 with the same body and `database: 'down'` otherwise.
- `openapi.json`: the committed OpenAPI document (Hub and the web app read it; ADR 0006). Generated, never edited; Biome skips it.
- `test/`: `app.ts` (`createTestApp()`, the app as production builds it on the run's test database), `global-setup.ts` (a fresh migrated database per run), `health.test.ts`, `openapi.test.ts`.

## Rules
- Injection is explicit: `@Inject(Token)` on every constructor parameter, classes included (no decorator metadata, so the build and Vitest behave the same; `packages/config/tsconfig/nest.json`).
- A controller declares its parameters with `{ schema }` from `@vertex-mizan/contracts`, its response with `@SerializeOptions({ schema })` and documents each answer with `@Api*Response({ standardSchema })`, then makes one call to its service. Schemas live in contracts with `.meta({ id })`.
- After changing a route or a contract it uses, regenerate the document with `pnpm --filter @vertex-mizan/api test -u` and commit `openapi.json` with the change; the test fails until it matches. CI's `pnpm check:openapi` refuses a breaking change against the base branch (ADR 0006: `/v1` is additive only).
- Every endpoint will declare its permission (AGENTS.md); the access guard and its decorators arrive with S01. `/api/health` is the one public route and returns no company data.
- The company context comes from the session or the API key through `withCompany`, never from input (ADR 0003). The API never connects as the owner role (ADR 0008).
- Logs through the Nest logger (pino); `authorization`, `cookie` and `set-cookie` headers are redacted. Never `console.log`.
- ESM: relative imports end in `.js`.

## Tests
Integration tests over HTTP with supertest on a fresh database per run (`DATABASE_OWNER_URL` and the role URLs, `packages/db/CLAUDE.md`); unit tests sit next to their file in `src/`. A route test covers success and the failure answers it documents.

Run: `pnpm --filter @vertex-mizan/api test` · `pnpm --filter @vertex-mizan/api typecheck` · `pnpm --filter @vertex-mizan/api start` (after `pnpm build`).
