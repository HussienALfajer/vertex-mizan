import { Body, Controller, HttpCode, Inject, Post, SerializeOptions } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type BackupCodes,
  backupCodesSchema,
  type Reauthenticate,
  type RequestPasswordReset,
  type ResetPassword,
  reauthenticateSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '@vertex-mizan/contracts';
import {
  Access,
  Public,
  Reauthenticated,
  type RequestAccess,
  SignedIn,
  signedIn,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { AccountService } from './account.service.js';

/** S01's own routes under `/api/auth`, registered before Better Auth's catch-all. */
@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Post('reauthenticate')
  @HttpCode(204)
  @SignedIn()
  @ApiNoContentResponse({ description: 'Sensitive actions are open for 5 minutes' })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'INVALID_TWO_FACTOR_CODE',
    'RATE_LIMITED',
    'VALIDATION_FAILED',
  )
  async reauthenticate(
    @Access() access: RequestAccess,
    @Body({ schema: reauthenticateSchema }) body: Reauthenticate,
  ): Promise<void> {
    await this.account.reauthenticate(signedIn(access), body.code);
  }

  @Post('two-factor/generate-backup-codes')
  @HttpCode(200)
  @SignedIn()
  @Reauthenticated()
  @SerializeOptions({ schema: backupCodesSchema })
  @ApiOkResponse({ description: 'Ten new codes, shown once', standardSchema: backupCodesSchema })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'REAUTHENTICATION_REQUIRED')
  async regenerateBackupCodes(@Access() access: RequestAccess): Promise<BackupCodes> {
    return this.account.regenerateBackupCodes(signedIn(access));
  }

  @Post('request-password-reset')
  @HttpCode(204)
  @Public()
  @ApiNoContentResponse({ description: 'The same answer whether the email exists or not' })
  @ApiErrors('RATE_LIMITED', 'VALIDATION_FAILED')
  async requestPasswordReset(
    @Access() access: RequestAccess,
    @Body({ schema: requestPasswordResetSchema }) body: RequestPasswordReset,
  ): Promise<void> {
    await this.account.requestPasswordReset(access, body.email);
  }

  @Post('reset-password')
  @HttpCode(204)
  @Public()
  @ApiNoContentResponse({ description: 'The password is set; every session ended' })
  @ApiErrors('LINK_INVALID', 'RATE_LIMITED', 'VALIDATION_FAILED')
  async resetPassword(
    @Access() access: RequestAccess,
    @Body({ schema: resetPasswordSchema }) body: ResetPassword,
  ): Promise<void> {
    await this.account.resetPassword(access, body.token, body.password);
  }
}
