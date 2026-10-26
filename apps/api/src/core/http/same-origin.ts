import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorResponse } from '@vertex-mizan/contracts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for every route (S01 "Abuse"), Better Auth's included: a state-changing request
 * that a browser marks as coming from another origin is refused, even from a sibling subdomain
 * that `SameSite` cookies would let through. Requests without these browser headers (scripts,
 * tests) carry no ambient cookie and pass. Copied from Vertex Hub's `same-origin.ts`.
 */
export function sameOriginOnly(appUrl: string) {
  const allowed = new URL(appUrl).origin;
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    const foreign =
      !SAFE_METHODS.has(request.method ?? 'GET') &&
      (origin !== undefined
        ? origin !== allowed
        : site !== undefined && site !== 'same-origin' && site !== 'none');
    if (!foreign) {
      next();
      return;
    }
    const body: ErrorResponse = {
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Cross-origin requests are refused',
    };
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };
}
