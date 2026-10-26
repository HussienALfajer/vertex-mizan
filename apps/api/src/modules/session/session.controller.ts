import { Body, Controller, HttpCode, Inject, Post, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type EnterCompany, enterCompanySchema, type Me, meSchema } from '@vertex-mizan/contracts';
import { Access, type RequestAccess, SignedIn, signedIn } from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { MeService } from '../me/me.service.js';

/** The active company of the session (S01 rules 19–20): the switcher. */
@ApiTags('session')
@Controller('session')
export class SessionController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Post('company')
  @HttpCode(200)
  @SignedIn()
  @SerializeOptions({ schema: meSchema })
  @ApiOkResponse({ description: 'The person, now in the company', standardSchema: meSchema })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'NOT_FOUND', 'VALIDATION_FAILED')
  async enter(
    @Access() access: RequestAccess,
    @Body({ schema: enterCompanySchema }) body: EnterCompany,
  ): Promise<Me> {
    return this.me.enterCompany(signedIn(access), body.companyId);
  }
}
