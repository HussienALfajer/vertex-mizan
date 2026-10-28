import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
  UploadedFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Attachment,
  attachmentParamsSchema,
  attachmentSchema,
  type DiscardDraft,
  type Draft,
  type DraftInput,
  type DraftPage,
  type DraftQuery,
  discardDraftSchema,
  draftInputSchema,
  draftPageSchema,
  draftQuerySchema,
  draftSchema,
  type EntryPreview,
  entryPreviewSchema,
  type IdParam,
  idParamSchema,
  type PostedDraft,
  postedDraftSchema,
  type RejectDraft,
  rejectDraftSchema,
  type UpdateDraft,
  updateDraftSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { AttachmentUpload, type UploadedAttachment } from '../../core/files/upload.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { DraftsService } from './drafts.service.js';

/** The refusals of the posting function a draft's posting or approval may answer (rules 5–16). */
const POSTING_ERRORS = [
  'ENTRY_TOO_FEW_LINES',
  'ENTRY_UNBALANCED',
  'ENTRY_DATE_OUT_OF_RANGE',
  'PERIOD_CLOSED',
  'RATE_MISSING',
  'DEALT_RATE_NOT_ACCEPTED',
  'RATE_ORIENTATION',
  'INVALID_RATE',
  'SYP_BEFORE_REDENOMINATION',
  'ACCOUNT_IS_CONTROL',
  'ACCOUNT_ROLE_MISSING',
  'ACCOUNT_NOT_POSTABLE',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_ARCHIVED',
  'ACCOUNT_CURRENCY_MISMATCH',
  'DIMENSION_REQUIRED',
  'DIMENSION_VALUE_ARCHIVED',
  'DIMENSION_PARENT_MISMATCH',
  'ENTRY_NOT_REVERSIBLE',
  'ENTRY_ALREADY_REVERSED',
  'REVERSAL_BEFORE_ORIGINAL',
  'IDEMPOTENCY_CONFLICT',
] as const;

/** `/api/drafts`: the drafts of manual entries and the approval queue (S03 rules 4–11, 17). */
@ApiTags('drafts')
@Controller('drafts')
export class DraftsController {
  constructor(@Inject(DraftsService) private readonly drafts: DraftsService) {}

  @Get()
  @ApiQueryFrom(draftQuerySchema)
  @CompanyRoute('drafts.read')
  @SerializeOptions({ schema: draftPageSchema })
  @ApiOkResponse({ description: 'Drafts, last changed first', standardSchema: draftPageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: draftQuerySchema }) query: DraftQuery,
  ): Promise<DraftPage> {
    return this.drafts.list(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiCreatedResponse({ description: 'The new draft', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS)
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: draftInputSchema }) body: DraftInput,
  ): Promise<Draft> {
    return this.drafts.create(inCompany(access), body);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('drafts.read')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The draft', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Draft> {
    return this.drafts.get(inCompany(access), params.id);
  }

  @Put(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The saved draft', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DRAFT_NOT_EDITABLE', 'DRAFT_CHANGED')
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateDraftSchema }) body: UpdateDraft,
  ): Promise<Draft> {
    return this.drafts.update(inCompany(access), params.id, body);
  }

  @Post(':id/preview')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('drafts.read')
  @SerializeOptions({ schema: entryPreviewSchema })
  @ApiOkResponse({
    description: 'The lines as they would post now, or what refuses them',
    standardSchema: entryPreviewSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async preview(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<EntryPreview> {
    return this.drafts.preview(inCompany(access), params.id);
  }

  @Post(':id/post')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('entries.post')
  @SerializeOptions({ schema: postedDraftSchema })
  @ApiOkResponse({
    description: 'The posted entry and the posted draft; posting twice answers the same entry',
    standardSchema: postedDraftSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DRAFT_NOT_EDITABLE',
    'APPROVAL_REQUIRED',
    ...POSTING_ERRORS,
  )
  async post(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<PostedDraft> {
    return this.drafts.post(inCompany(access), params.id);
  }

  @Post(':id/submit')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The submitted draft', standardSchema: draftSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DRAFT_NOT_EDITABLE',
    'APPROVAL_NOT_REQUIRED',
    'ENTRY_TOO_FEW_LINES',
  )
  async submit(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Draft> {
    return this.drafts.submit(inCompany(access), params.id);
  }

  @Post(':id/withdraw')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The draft, back to draft', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DRAFT_NOT_EDITABLE')
  async withdraw(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Draft> {
    return this.drafts.withdraw(inCompany(access), params.id);
  }

  @Post(':id/discard')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The discarded draft', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DRAFT_NOT_EDITABLE')
  async discard(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: discardDraftSchema }) body: DiscardDraft,
  ): Promise<Draft> {
    return this.drafts.discard(inCompany(access), params.id, body.reason);
  }

  @Post(':id/approve')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('entries.approve')
  @SerializeOptions({ schema: postedDraftSchema })
  @ApiOkResponse({ description: 'The posted entry and draft', standardSchema: postedDraftSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DRAFT_NOT_EDITABLE',
    'APPROVER_IS_PREPARER',
    ...POSTING_ERRORS,
  )
  async approve(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<PostedDraft> {
    return this.drafts.approve(inCompany(access), params.id);
  }

  @Post(':id/reject')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('entries.approve')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({
    description: 'The draft, back to draft with the reason',
    standardSchema: draftSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DRAFT_NOT_EDITABLE', 'APPROVER_IS_PREPARER')
  async reject(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: rejectDraftSchema }) body: RejectDraft,
  ): Promise<Draft> {
    return this.drafts.reject(inCompany(access), params.id, body.reason);
  }

  @Post(':id/attachments')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('drafts.manage')
  @AttachmentUpload()
  @SerializeOptions({ schema: attachmentSchema })
  @ApiCreatedResponse({ description: 'The attachment', standardSchema: attachmentSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DRAFT_NOT_EDITABLE',
    'ATTACHMENT_TYPE',
    'ATTACHMENT_TOO_LARGE',
    'ATTACHMENT_LIMIT',
  )
  async attach(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @UploadedFile() file: UploadedAttachment | undefined,
  ): Promise<Attachment> {
    return this.drafts.attach(inCompany(access), params.id, file);
  }

  @Delete(':id/attachments/:attachmentId')
  @ApiParamsFrom(attachmentParamsSchema)
  @CompanyRoute('drafts.manage')
  @SerializeOptions({ schema: draftSchema })
  @ApiOkResponse({ description: 'The draft without the file', standardSchema: draftSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DRAFT_NOT_EDITABLE')
  async removeAttachment(
    @Access() access: RequestAccess,
    @Param({ schema: attachmentParamsSchema }) params: { id: string; attachmentId: string },
  ): Promise<Draft> {
    return this.drafts.removeAttachment(inCompany(access), params.id, params.attachmentId);
  }
}
