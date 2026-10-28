import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  SerializeOptions,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AccountLinesPage,
  type AccountLinesQuery,
  ATTACHMENT_CONTENT_TYPES,
  type Attachment,
  accountLinesPageSchema,
  accountLinesQuerySchema,
  attachmentSchema,
  type Draft,
  draftSchema,
  type Entry,
  type EntryPage,
  type EntryQuery,
  entryPageSchema,
  entryQuerySchema,
  entrySchema,
  type IdParam,
  idParamSchema,
  type PageQuery,
  pageQuerySchema,
  type ReversalResult,
  type ReverseEntry,
  reversalResultSchema,
  reverseEntrySchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { AttachmentUpload, type UploadedAttachment } from '../../core/files/upload.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { EntriesService } from './entries.service.js';

/** `/api/entries`: the journal, an entry, its reversal, copy and attachments (S03). */
@ApiTags('entries')
@Controller('entries')
export class EntriesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get()
  @ApiQueryFrom(entryQuerySchema)
  @CompanyRoute('entries.read')
  @SerializeOptions({ schema: entryPageSchema })
  @ApiOkResponse({
    description: 'Entries, newest entry date first',
    standardSchema: entryPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: entryQuerySchema }) query: EntryQuery,
  ): Promise<EntryPage> {
    return this.entries.list(inCompany(access), query);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('entries.read')
  @SerializeOptions({ schema: entrySchema })
  @ApiOkResponse({ description: 'The entry with its lines', standardSchema: entrySchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Entry> {
    return this.entries.get(inCompany(access), params.id);
  }

  @Post(':id/reverse')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: reversalResultSchema })
  @ApiOkResponse({
    description:
      'The posted reversal (approval off, needs entries.post), or its draft (approval on)',
    standardSchema: reversalResultSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ENTRY_NOT_REVERSIBLE',
    'ENTRY_ALREADY_REVERSED',
    'REVERSAL_BEFORE_ORIGINAL',
    'ENTRY_DATE_OUT_OF_RANGE',
    'PERIOD_CLOSED',
  )
  async reverse(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reverseEntrySchema }) body: ReverseEntry,
  ): Promise<ReversalResult> {
    return this.entries.reverse(inCompany(access), params.id, body);
  }

  @Post(':id/copy')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiCreatedResponse({ description: 'The new draft, dated today', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async copy(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Draft> {
    return this.entries.copy(inCompany(access), params.id);
  }

  @Post(':id/attachments')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('entries.attach')
  @AttachmentUpload()
  @SerializeOptions({ schema: attachmentSchema })
  @ApiCreatedResponse({ description: 'The attachment', standardSchema: attachmentSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ATTACHMENT_TYPE',
    'ATTACHMENT_TOO_LARGE',
    'ATTACHMENT_LIMIT',
  )
  async attach(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @UploadedFile() file: UploadedAttachment | undefined,
  ): Promise<Attachment> {
    return this.entries.attach(inCompany(access), params.id, file);
  }
}

/** `/api/attachments/:id`: an attachment's file, as a download, never rendered inline. */
@ApiTags('entries')
@Controller('attachments')
export class AttachmentsController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('entries.read')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @ApiOkProducesResponse("The file; a draft's needs drafts.read as well", ATTACHMENT_CONTENT_TYPES)
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async download(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<StreamableFile> {
    const file = await this.entries.download(inCompany(access), params.id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.body.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}

/** `/api/accounts/:id/lines`: an account's lines with running balances (S03 "Screens"). */
@ApiTags('entries')
@Controller('accounts')
export class AccountLinesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get(':id/lines')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(accountLinesQuerySchema)
  @CompanyRoute('entries.read')
  @SerializeOptions({ schema: accountLinesPageSchema })
  @ApiOkResponse({
    description: 'The opening balance and the lines, oldest first',
    standardSchema: accountLinesPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async lines(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: accountLinesQuerySchema }) query: AccountLinesQuery,
  ): Promise<AccountLinesPage> {
    return this.entries.accountLines(inCompany(access), params.id, query);
  }
}

/** `/api/rates/:id/entries`: the entries that used a rate row (S02 rule 15). */
@ApiTags('entries')
@Controller('rates')
export class RateEntriesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get(':id/entries')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(pageQuerySchema)
  @CompanyRoute('entries.read')
  @SerializeOptions({ schema: entryPageSchema })
  @ApiOkResponse({ description: 'The entries, newest first', standardSchema: entryPageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async list(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<EntryPage> {
    return this.entries.rateEntries(inCompany(access), params.id, query);
  }
}
