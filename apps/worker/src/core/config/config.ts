import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The role pg-boss runs as, in its own schema only (`packages/db/CLAUDE.md`, ADR 0003). */
export const QUEUE_ROLE = 'mizan_queue';

/** The role the jobs that read the application's tables connect as (ADR 0008). */
export const APP_ROLE = 'mizan_app';

/** The role of the jobs that reach across companies, through its own policies (ADR 0003). */
export const JOBS_ROLE = 'mizan_jobs';

/**
 * Where files live outside production when `MIZAN_FILES_DIR` is unset: `.data/files/` at the
 * repository root, as in `apps/api`, the same from `src/` and `dist/`.
 */
export const DEVELOPMENT_FILES_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../..',
  '.data/files',
);

/** A Postgres URL that names `role` as its user, never through a `user` query parameter. */
const roleUrl = (role: string) =>
  z.url({ protocol: /^postgres(ql)?$/ }).refine((url) => {
    const parsed = new URL(url);
    // node-postgres lets a `user` query parameter override the URL's user.
    return parsed.username === role && !parsed.searchParams.has('user');
  });

/**
 * The worker's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. The queue URL must name the queue role, so pg-boss never runs as
 * the owner or the app role, and the app URL the app role (ADR 0008). Error messages name the variable, never its value (the
 * URLs carry passwords).
 */
const configSchema = z
  .object({
    DATABASE_QUEUE_URL: roleUrl(QUEUE_ROLE),
    /** The app role, for the email outbox and the clean-up of the ephemeral tables (S01). */
    DATABASE_APP_URL: roleUrl(APP_ROLE),
    /** The jobs role: the daily anchor and finding the exports across companies (S03). */
    DATABASE_JOBS_URL: roleUrl(JOBS_ROLE),
    /** The web app's origin, the base of the links in emails, as in `apps/api`. */
    APP_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://127.0.0.1:5173')
      .transform((url) => new URL(url).origin),
    /**
     * The directory of attachments and exports (S03), shared with `apps/api`: an absolute path,
     * required in production.
     */
    MIZAN_FILES_DIR: z.string().refine(isAbsolute).optional(),
    /** The server's SMTP account (ADR 0008): `smtp://` or `smtps://`, with its user and password. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    /** The sender of every email, as `Name <address>`. */
    EMAIL_FROM: z.string().min(3),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.MIZAN_FILES_DIR !== undefined, {
    path: ['MIZAN_FILES_DIR'],
  })
  .transform((env) => ({
    queueDatabaseUrl: env.DATABASE_QUEUE_URL,
    appDatabaseUrl: env.DATABASE_APP_URL,
    jobsDatabaseUrl: env.DATABASE_JOBS_URL,
    appUrl: env.APP_URL,
    filesDir: env.MIZAN_FILES_DIR ?? DEVELOPMENT_FILES_DIR,
    smtpUrl: env.SMTP_URL,
    emailFrom: env.EMAIL_FROM,
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
  }));

export type Config = z.output<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].join(
      ', ',
    );
    throw new Error(`Invalid worker environment: ${names}`);
  }
  return result.data;
}
