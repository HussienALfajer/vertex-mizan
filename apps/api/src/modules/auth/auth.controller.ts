import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type EnableTwoFactor,
  type ErrorCode,
  enableTwoFactorSchema,
  errorStatus,
  type SignIn,
  type SignInResult,
  signInResultSchema,
  signInSchema,
  type TwoFactorSetup,
  twoFactorSetupSchema,
  type VerifyBackupCode,
  type VerifyTotp,
  verifyBackupCodeSchema,
  verifyTotpSchema,
} from '@vertex-mizan/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { factsOf } from '../../core/access/access.guard.js';
import {
  Access,
  Public,
  type RequestAccess,
  SignedIn,
  signedIn,
} from '../../core/access/access.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { AccountService } from './account.service.js';
import { AUTH, AUTH_BASE_PATH, type Auth } from './auth.js';

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
 * The Better Auth routes S01 uses (ADR 0002, S01 "API"), one handler each, behind our access guard,
 * filters and same-origin check. Each checks its body with its contract (unknown fields such as
 * `trustDevice` are dropped), hands Better Auth a request with the request ID and the client
 * address Express resolved, and answers in our shapes and codes. Success bodies never carry the
 * session token, which lives only in its `HttpOnly` cookie. Every other Better Auth path (sign-up,
 * social sign-in, profile and email changes, session lists, two-factor disable and email codes)
 * has no route here and answers `NOT_FOUND`.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Post('sign-in/email')
  @HttpCode(200)
  @Public()
  @ApiOkResponse({
    description: 'Whether a code is needed next; without one, a session that reaches enrolment',
    standardSchema: signInResultSchema,
  })
  @ApiErrors('INVALID_CREDENTIALS', 'RATE_LIMITED', 'VALIDATION_FAILED')
  async signIn(
    @Req() request: Request,
    @Res() response: Response,
    @Body({ schema: signInSchema }) body: SignIn,
  ): Promise<void> {
    const answer = await this.forward(request, response, '/sign-in/email', body);
    const result: SignInResult = {
      twoFactorRequired: (answer as { twoFactorRedirect?: unknown }).twoFactorRedirect === true,
    };
    response.status(200).json(result);
  }

  @Post('two-factor/verify-totp')
  @HttpCode(204)
  @Public()
  @ApiNoContentResponse({ description: 'Signed in (the session cookie), or enrolment done' })
  @ApiErrors('INVALID_TWO_FACTOR_CODE', 'RATE_LIMITED', 'VALIDATION_FAILED')
  async verifyTotp(
    @Req() request: Request,
    @Res() response: Response,
    @Body({ schema: verifyTotpSchema }) body: VerifyTotp,
  ): Promise<void> {
    await this.forward(request, response, '/two-factor/verify-totp', body);
    response.status(204).end();
  }

  @Post('two-factor/verify-backup-code')
  @HttpCode(204)
  @Public()
  @ApiNoContentResponse({ description: 'Signed in with a backup code, which is now used' })
  @ApiErrors('INVALID_TWO_FACTOR_CODE', 'RATE_LIMITED', 'VALIDATION_FAILED')
  async verifyBackupCode(
    @Req() request: Request,
    @Res() response: Response,
    @Body({ schema: verifyBackupCodeSchema }) body: VerifyBackupCode,
  ): Promise<void> {
    await this.forward(request, response, '/two-factor/verify-backup-code', body);
    response.status(204).end();
  }

  @Post('two-factor/enable')
  @HttpCode(200)
  @SignedIn({ beforeEnrolment: true })
  @ApiOkResponse({
    description: 'A new authenticator, effective once its first code verifies',
    standardSchema: twoFactorSetupSchema,
  })
  @ApiErrors(
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'REAUTHENTICATION_REQUIRED',
    'RATE_LIMITED',
    'VALIDATION_FAILED',
  )
  async enable(
    @Req() request: Request,
    @Res() response: Response,
    @Access() access: RequestAccess,
    @Body({ schema: enableTwoFactorSchema }) body: EnableTwoFactor,
  ): Promise<void> {
    const signed = signedIn(access);
    if (signed.person.twoFactorEnabled) {
      response.status(200).json(await this.account.startReenrolment(signed, body.password));
      return;
    }
    const answer = (await this.forward(
      request,
      response,
      '/two-factor/enable',
      body,
    )) as TwoFactorSetup;
    const setup: TwoFactorSetup = { totpURI: answer.totpURI, backupCodes: answer.backupCodes };
    response.status(200).json(setup);
  }

  @Post('sign-out')
  @HttpCode(204)
  @SignedIn({ beforeEnrolment: true })
  @ApiNoContentResponse({ description: 'The session ended' })
  @ApiErrors('UNAUTHENTICATED')
  async signOut(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.forward(request, response, '/sign-out', {});
    response.status(204).end();
  }

  /**
   * Hands one checked request to Better Auth and passes its cookies on: a refusal becomes our
   * coded error, a success returns Better Auth's body for the handler to reshape.
   */
  private async forward(
    request: Request,
    response: Response,
    path: string,
    body: object,
  ): Promise<unknown> {
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
      new Request(`http://${request.get('host') ?? 'localhost'}${AUTH_BASE_PATH}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    for (const cookie of answer.headers.getSetCookie()) response.append('set-cookie', cookie);
    const answered: unknown = await answer.json().catch(() => null);
    if (!answer.ok) {
      const code = codeOf(answer.status, answered);
      if (!code) throw new Error(`Better Auth answered ${answer.status} on ${path}`);
      throw new CodedException(code, 'Refused by the sign-in');
    }
    return answered;
  }
}
