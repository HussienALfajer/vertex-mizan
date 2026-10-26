import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  backupCodeSchema,
  type ErrorCode,
  errorStatus,
  signInSchema,
  totpCodeSchema,
} from '@vertex-mizan/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { factsOf } from '../../core/access/access.guard.js';
import { Public } from '../../core/access/access.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { CodedException, issuesOf } from '../../core/errors/coded-exception.js';
import { AUTH, AUTH_BASE_PATH, type Auth } from './auth.js';

/**
 * The Better Auth routes S01 uses, each with the body it takes; every other path of Better Auth
 * answers `NOT_FOUND` without reaching it (sign-up, social sign-in, profile and email changes,
 * session lists, two-factor disable and email codes, "trust this device"). Unknown fields are
 * dropped by the schemas, so `trustDevice` never reaches it either.
 */
const ROUTES: Record<string, z.ZodType> = {
  '/sign-in/email': signInSchema,
  '/sign-out': z.object({}),
  '/two-factor/enable': z.object({ password: z.string().min(1).max(128) }),
  '/two-factor/verify-totp': z.object({ code: totpCodeSchema }),
  '/two-factor/verify-backup-code': z.object({ code: backupCodeSchema }),
};

/** Better Auth's error codes, as ours (S01 "API": every error answer carries one of our codes). */
const CODES: Record<string, ErrorCode> = {
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_CREDENTIALS',
  INVALID_PASSWORD: 'INVALID_CREDENTIALS',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'INVALID_CREDENTIALS',
  INVALID_CODE: 'INVALID_TWO_FACTOR_CODE',
  INVALID_BACKUP_CODE: 'INVALID_TWO_FACTOR_CODE',
  INVALID_TWO_FACTOR_COOKIE: 'INVALID_TWO_FACTOR_CODE',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'INVALID_TWO_FACTOR_CODE',
  TOTP_NOT_ENABLED: 'INVALID_TWO_FACTOR_CODE',
  BACKUP_CODES_NOT_ENABLED: 'INVALID_TWO_FACTOR_CODE',
  ACCOUNT_TEMPORARILY_LOCKED: 'RATE_LIMITED',
  TOTP_ALREADY_ENABLED: 'FORBIDDEN',
  PASSWORD_TOO_LONG: 'VALIDATION_FAILED',
  INVALID_EMAIL: 'VALIDATION_FAILED',
};

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

function codeOf(status: number, body: unknown): ErrorCode | undefined {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code in errorStatus) return code as ErrorCode;
    if (CODES[code]) return CODES[code];
  }
  return CODE_BY_STATUS[status];
}

/**
 * Mounts Better Auth at `/api/auth` (ADR 0002, S01 "API") behind our access guard, filters and
 * same-origin check: it checks the body, hands Better Auth a request with the request ID and the
 * client address Express resolved, and answers in our shapes. Success bodies never carry the
 * session token, which lives only in its `HttpOnly` cookie. Our own routes under `/api/auth`
 * (re-authentication, password reset, backup codes) are registered before this one and win.
 */
@ApiExcludeController()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @All('*path')
  @Public()
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    const path = request.path.slice(AUTH_BASE_PATH.length);
    const schema = ROUTES[path];
    if (!schema || request.method !== 'POST') {
      throw new CodedException('NOT_FOUND', 'No such route');
    }
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new CodedException(
        'VALIDATION_FAILED',
        'Validation failed',
        issuesOf(parsed.error.issues),
      );
    }

    const facts = factsOf(request);
    const headers = fromNodeHeaders(request.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    headers.set('x-request-id', facts.requestId);
    // The same-origin check already refused a foreign browser origin (`same-origin.ts`); Better
    // Auth's own check then sees the app's origin, also on requests from scripts and tests.
    headers.set('origin', this.config.appUrl);
    if (facts.ipAddress) headers.set('x-forwarded-for', facts.ipAddress);
    else headers.delete('x-forwarded-for');
    const answer = await this.auth.handler(
      new Request(new URL(request.originalUrl, `http://${request.get('host') ?? 'localhost'}`), {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed.data),
      }),
    );

    for (const cookie of answer.headers.getSetCookie()) response.append('set-cookie', cookie);
    const body: unknown = await answer.json().catch(() => null);
    if (!answer.ok) {
      const code = codeOf(answer.status, body);
      if (!code) throw new Error(`Better Auth answered ${answer.status} on ${path}`);
      throw new CodedException(code, 'Refused by the sign-in');
    }
    switch (path) {
      case '/sign-in/email':
        response.status(200).json({
          twoFactorRequired: (body as { twoFactorRedirect?: unknown }).twoFactorRedirect === true,
        });
        return;
      case '/two-factor/enable': {
        const { totpURI, backupCodes } = body as { totpURI: string; backupCodes: string[] };
        response.status(200).json({ totpURI, backupCodes });
        return;
      }
      default:
        response.status(204).end();
    }
  }
}
