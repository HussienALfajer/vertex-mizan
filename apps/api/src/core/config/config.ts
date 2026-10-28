import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The role the API connects as (`packages/db/CLAUDE.md`). */
export const APP_ROLE = 'mizan_app';

/**
 * The placeholder `AUTH_SECRET` of `.env.example`. The repository is public, so a server that
 * kept it would sign sessions and encrypt two-factor secrets with a known key: refused (S01).
 */
export const EXAMPLE_AUTH_SECRET =
  'replace-with-node-e-console-log-crypto-randomBytes-32-base64url';

/**
 * Where files live outside production when `MIZAN_FILES_DIR` is unset: `.data/files/` at the
 * repository root (git-ignored local data), the same from `src/` and `dist/`.
 */
export const DEVELOPMENT_FILES_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../..',
  '.data/files',
);

/**
 * The API's environment, checked once at start-up: a missing or malformed value stops the process
 * before it serves anything. Error messages name the variable, never its value (the database URL
 * carries a password).
 */
const configSchema = z
  .object({
    /**
     * The app role (ADR 0003, ADR 0008): never the owner, and never `mizan_jobs`, which
     * `createDatabase` also accepts but which reaches across companies through its own policies.
     */
    DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }).refine((url) => {
      const parsed = new URL(url);
      // node-postgres lets a `user` query parameter override the URL's user.
      return parsed.username === APP_ROLE && !parsed.searchParams.has('user');
    }),
    /**
     * Signs session cookies and encrypts two-factor secrets and backup codes (Better Auth, S01):
     * at least 32 characters, never the example value.
     */
    AUTH_SECRET: z
      .string()
      .min(32)
      .refine((secret) => secret !== EXAMPLE_AUTH_SECRET),
    /**
     * The web app's origin: the only origin allowed to send writes (the same-origin check), and
     * the base of the links in emails.
     */
    APP_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://127.0.0.1:5173')
      .transform((url) => new URL(url).origin),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3300),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /**
     * The directory of attachments and exports (S03, ADR 0008 "Attachments"): on the server's
     * disk, outside the web root, one folder per company, served only through the API. An
     * absolute path; required in production.
     */
    MIZAN_FILES_DIR: z.string().refine(isAbsolute).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.MIZAN_FILES_DIR !== undefined, {
    path: ['MIZAN_FILES_DIR'],
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_APP_URL,
    authSecret: env.AUTH_SECRET,
    appUrl: env.APP_URL,
    host: env.API_HOST,
    port: env.API_PORT,
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    filesDir: env.MIZAN_FILES_DIR ?? DEVELOPMENT_FILES_DIR,
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].join(
      ', ',
    );
    throw new Error(`Invalid API environment: ${names}`);
  }
  return result.data;
}
