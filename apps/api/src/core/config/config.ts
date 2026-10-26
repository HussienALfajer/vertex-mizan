import { z } from 'zod';

/**
 * The API's environment, checked once at start-up: a missing or malformed value stops the process
 * before it serves anything. Error messages name the variable, never its value (the database URL
 * carries a password).
 */
const configSchema = z
  .object({
    /** The app role (ADR 0008); `createDatabase` refuses any other. */
    DATABASE_APP_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3300),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_APP_URL,
    host: env.API_HOST,
    port: env.API_PORT,
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
    throw new Error(`Invalid API environment: ${names}`);
  }
  return result.data;
}
