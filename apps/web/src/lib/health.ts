import { queryOptions } from '@tanstack/react-query';
import { type HealthResponse, healthResponseSchema } from '@vertex-mizan/contracts';

/** `GET /api/health`: 503 still carries a health body naming the dependency that is down. */
async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`GET /api/health: HTTP ${response.status}`);
  }
  return healthResponseSchema.parse(await response.json());
}

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  refetchInterval: 30_000,
  retry: false,
});
