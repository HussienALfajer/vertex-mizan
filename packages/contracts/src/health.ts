import { z } from 'zod';

/**
 * `GET /api/health`: whether the API and the database it depends on answer. The API returns it
 * with 200 when every check is up and with 503 otherwise, so a load balancer needs only the status.
 */
export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'error']),
    checks: z.object({
      database: z.enum(['up', 'down']),
    }),
    timestamp: z.iso.datetime(),
  })
  .meta({ id: 'HealthResponse', description: 'Whether the API and its database answer' });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
