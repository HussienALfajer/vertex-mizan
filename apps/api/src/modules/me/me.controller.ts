import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ChangePassword,
  changePasswordSchema,
  type Me,
  meSchema,
  type PageQuery,
  pageQuerySchema,
  type SignInPage,
  signInPageSchema,
} from '@vertex-mizan/contracts';
import {
  Access,
  Reauthenticated,
  type RequestAccess,
  SignedIn,
  signedIn,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { ApiQueryFrom } from '../../core/http/api-parameters.js';
import { MeService } from './me.service.js';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Get()
  @SignedIn({ beforeEnrolment: true })
  @SerializeOptions({ schema: meSchema })
  @ApiOkResponse({
    description: 'The person, their companies and permissions',
    standardSchema: meSchema,
  })
  @ApiErrors('UNAUTHENTICATED')
  async get(@Access() access: RequestAccess): Promise<Me> {
    return this.me.me(signedIn(access));
  }

  @Get('sign-ins')
  @ApiQueryFrom(pageQuerySchema)
  @SignedIn()
  @SerializeOptions({ schema: signInPageSchema })
  @ApiOkResponse({
    description: 'Own sign-in events, newest first',
    standardSchema: signInPageSchema,
  })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'VALIDATION_FAILED')
  async signIns(
    @Access() access: RequestAccess,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<SignInPage> {
    return this.me.signIns(signedIn(access), query.cursor);
  }

  @Post('password')
  @HttpCode(204)
  @SignedIn()
  @Reauthenticated()
  @ApiNoContentResponse({ description: 'Changed; every session of the person ended' })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'INVALID_CREDENTIALS',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
    'RATE_LIMITED',
  )
  async changePassword(
    @Access() access: RequestAccess,
    @Body({ schema: changePasswordSchema }) body: ChangePassword,
  ): Promise<void> {
    await this.me.changePassword(signedIn(access), body.currentPassword, body.newPassword);
  }
}
