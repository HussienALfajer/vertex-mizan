import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type OpeningEntryResult,
  type OpeningExportQuery,
  type OpeningViewAnswer,
  openingEntryResultSchema,
  openingExportQuerySchema,
  openingViewSchema,
  type PostOpening,
  postOpeningSchema,
  type ReverseOpening,
  reverseOpeningSchema,
  type SaveOpening,
  saveOpeningSchema,
} from '@vertex-mizan/contracts';
import {
  Access,
  CompanyRoute,
  inCompany,
  Reauthenticated,
  type RequestAccess,
} from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiQueryFrom } from '../../core/http/api-parameters.js';
import { OpeningService } from './opening.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `/api/opening` (S10 "API"): the opening's view, its draft, its posting and its reversal. */
@ApiTags('opening')
@Controller('opening')
export class OpeningController {
  constructor(@Inject(OpeningService) private readonly opening: OpeningService) {}

  @Get()
  @CompanyRoute('opening.read')
  @SerializeOptions({ schema: openingViewSchema })
  @ApiOkResponse({
    description:
      "The opening: its state, Hub's snapshot and items, the records' lines and figures, the agreement, the entry it would post, the checks and the fingerprint",
    standardSchema: openingViewSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NO_BOOKS_START')
  read(@Access() access: RequestAccess): Promise<OpeningViewAnswer> {
    return this.opening.read(inCompany(access));
  }

  @Get('export')
  @ApiQueryFrom(openingExportQuerySchema)
  @CompanyRoute('opening.read')
  @ApiOkProducesResponse("The opening's preview or its agreement with Hub as an Excel workbook", [
    XLSX,
  ])
  @ApiErrors(...COMPANY_READ_ERRORS, 'NO_BOOKS_START', 'VALIDATION_FAILED')
  async export(
    @Access() access: RequestAccess,
    @Query({ schema: openingExportQuerySchema }) query: OpeningExportQuery,
  ): Promise<StreamableFile> {
    const file = await this.opening.export(inCompany(access), query);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  @Put()
  @CompanyRoute('opening.prepare')
  @SerializeOptions({ schema: openingViewSchema })
  @ApiOkResponse({
    description: 'The draft saved against its version, and the opening read again',
    standardSchema: openingViewSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'VALIDATION_FAILED',
    'OPENING_CHANGED',
    'OPENING_POSTED',
    'NO_BOOKS_START',
  )
  save(
    @Access() access: RequestAccess,
    @Body({ schema: saveOpeningSchema }) body: SaveOpening,
  ): Promise<OpeningViewAnswer> {
    return this.opening.save(inCompany(access), body);
  }

  @Post('post')
  @HttpCode(200)
  @CompanyRoute('opening.post')
  @Reauthenticated()
  @SerializeOptions({ schema: openingEntryResultSchema })
  @ApiOkResponse({
    description: 'The opening entry posted on the books start',
    standardSchema: openingEntryResultSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'VALIDATION_FAILED',
    'OPENING_CHANGED',
    'OPENING_CHECKS_FAILED',
    'OPENING_POSTED',
    'NO_BOOKS_START',
    'REAUTHENTICATION_REQUIRED',
  )
  post(
    @Access() access: RequestAccess,
    @Body({ schema: postOpeningSchema }) body: PostOpening,
  ): Promise<OpeningEntryResult> {
    return this.opening.post(inCompany(access), body.fingerprint);
  }

  @Post('reverse')
  @HttpCode(200)
  @CompanyRoute('opening.post')
  @Reauthenticated()
  @SerializeOptions({ schema: openingEntryResultSchema })
  @ApiOkResponse({
    description: "The opening entry's whole reversal, while it is the company's only entry",
    standardSchema: openingEntryResultSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'VALIDATION_FAILED',
    'OPENING_NOT_REVERSIBLE',
    'NO_BOOKS_START',
    'REAUTHENTICATION_REQUIRED',
  )
  reverse(
    @Access() access: RequestAccess,
    @Body({ schema: reverseOpeningSchema }) body: ReverseOpening,
  ): Promise<OpeningEntryResult> {
    return this.opening.reverse(inCompany(access), body.reason);
  }
}
