import { Controller, Get, Inject, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuditPage,
  type AuditQuery,
  auditPageSchema,
  auditQuerySchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { ApiQueryFrom } from '../../core/http/api-parameters.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @ApiQueryFrom(auditQuerySchema)
  @CompanyRoute('audit.read')
  @SerializeOptions({ schema: auditPageSchema })
  @ApiOkResponse({ description: 'Audit entries, newest first', standardSchema: auditPageSchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SWITCHED',
    'VALIDATION_FAILED',
  )
  async page(
    @Access() access: RequestAccess,
    @Query({ schema: auditQuerySchema }) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.audit.page(inCompany(access), query);
  }
}
