import { Body, Controller, HttpCode, Inject, Post, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type IntegrityCheck,
  type IntegrityReport,
  integrityCheckSchema,
  integrityReportSchema,
} from '@vertex-mizan/contracts';
import {
  Access,
  CompanyRoute,
  inCompany,
  type RequestAccess,
  WhileArchived,
} from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { IntegrityService } from './integrity.service.js';

/** `/api/integrity`: the integrity check (S03 rule 19). */
@ApiTags('integrity')
@Controller('integrity')
export class IntegrityController {
  constructor(@Inject(IntegrityService) private readonly integrity: IntegrityService) {}

  /** A read of the books, so an archived company's books can be checked too. */
  @Post('check')
  @HttpCode(200)
  @CompanyRoute('integrity.read')
  @WhileArchived()
  @SerializeOptions({ schema: integrityReportSchema })
  @ApiOkResponse({
    description: 'The chain, numbers, balances and anchors recomputed from the first entry',
    standardSchema: integrityReportSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async check(
    @Access() access: RequestAccess,
    @Body({ schema: integrityCheckSchema }) body: IntegrityCheck,
  ): Promise<IntegrityReport> {
    return this.integrity.check(inCompany(access), body);
  }
}
