import { z } from 'zod';

/** The role pg-boss runs as, in its own schema only (`packages/db/CLAUDE.md`, ADR 0003). */
export const QUEUE_ROLE = 'mizan_queue';

/** The role the jobs that read the application's tables connect as (ADR 0008). */
export const APP_ROLE = 'mizan_app';

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
    /** The server's SMTP account (ADR 0008): `smtp://` or `smtps://`, with its user and password. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    /** The sender of every email, as `Name <address>`. */
    EMAIL_FROM: z.string().min(3),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .transform((env) => ({
    queueDatabaseUrl: env.DATABASE_QUEUE_URL,
    appDatabaseUrl: env.DATABASE_APP_URL,
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
