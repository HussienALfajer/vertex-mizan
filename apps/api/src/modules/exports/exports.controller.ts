import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CompanyExport,
  companyExportSchema,
  type IdParam,
  idParamSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  Reauthenticated,
  type RequestAccess,
  WhileArchived,
} from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom } from '../../core/http/api-parameters.js';
import { ExportsService } from './exports.service.js';

/**
 * `/api/company/exports`: the owner's full export of the company's data (S03 rule 21). A read of
 * the books, so an archived company's data can be exported too.
 */
@ApiTags('company')
@Controller('company/exports')
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Post()
  @CompanyRoute('company.export')
  @WhileArchived()
  @Reauthenticated()
  @SerializeOptions({ schema: companyExportSchema })
  @ApiCreatedResponse({ description: 'The export, queued', standardSchema: companyExportSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'REAUTHENTICATION_REQUIRED', 'EXPORT_IN_PROGRESS')
  async request(@Access() access: RequestAccess): Promise<CompanyExport> {
    return this.exports.request(inCompany(access));
  }

  @Get()
  @CompanyRoute('company.export')
  @SerializeOptions({ schema: companyExportSchema })
  @ApiOkResponse({
    description: 'The newest exports first',
    standardSchema: z.array(companyExportSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<CompanyExport[]> {
    return this.exports.list(inCompany(access));
  }

  /** The whole company's data: a fresh code, as for the request (S03 "Access", a leaked link). */
  @Get(':id/download')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('company.export')
  @Reauthenticated()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @ApiOkProducesResponse('The export as a ZIP, for 24 hours after it is ready', ['application/zip'])
  @ApiErrors(
    ...COMPANY_READ_ERRORS,
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'LINK_INVALID',
  )
  async download(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<StreamableFile> {
    const file = await this.exports.download(inCompany(access), params.id);
    return new StreamableFile(file.stream, {
      type: 'application/zip',
      length: file.size,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}
