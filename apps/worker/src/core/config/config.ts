import { z } from 'zod';

/** The role pg-boss runs as, in its own schema only (`packages/db/CLAUDE.md`, ADR 0003). */
export const QUEUE_ROLE = 'mizan_queue';

/**
 * The worker's environment, checked once at start-up: a missing or malformed value stops the
 * process before it runs anything. The queue URL must name the queue role, so pg-boss never runs as
 * the owner or the app role (ADR 0008). Error messages name the variable, never its value (the
 * URLs carry passwords).
 */
const configSchema = z
  .object({
    DATABASE_QUEUE_URL: z.url({ protocol: /^postgres(ql)?$/ }).refine((url) => {
      const parsed = new URL(url);
      // node-postgres lets a `user` query parameter override the URL's user.
      return parsed.username === QUEUE_ROLE && !parsed.searchParams.has('user');
    }),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .transform((env) => ({
    queueDatabaseUrl: env.DATABASE_QUEUE_URL,
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
