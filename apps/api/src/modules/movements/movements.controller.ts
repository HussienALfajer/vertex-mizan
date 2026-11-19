import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Branding,
  brandingSchema,
  type CancelMovement,
  type CreateParty,
  type CreateProject,
  cancelMovementSchema,
  createPartySchema,
  createProjectSchema,
  type Dashboard,
  type DayRates,
  type DayRatesQuery,
  dashboardSchema,
  dayRatesQuerySchema,
  dayRatesSchema,
  type IdParam,
  idParamSchema,
  LOGO_CONTENT_TYPES,
  type MaterialCostQuery,
  type MaterialCosts,
  type Movement,
  type MovementPage,
  type MovementQuery,
  materialCostQuerySchema,
  materialCostsSchema,
  movementPageSchema,
  movementQuerySchema,
  movementSchema,
  type Party,
  type PartyQuery,
  type Project,
  type ProjectQuery,
  partyQuerySchema,
  partySchema,
  projectQuerySchema,
  projectSchema,
  type RecordDayRates,
  type RecordMovement,
  recordDayRatesSchema,
  recordMovementSchema,
  type UpdateBranding,
  type UpdateProject,
  updateBrandingSchema,
  updateProjectSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  Public,
  type RequestAccess,
} from '../../core/access/access.js';
import { AttachmentUpload, type UploadedAttachment } from '../../core/files/upload.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { type LogoFile, MovementsService } from './movements.service.js';

/** A logo served inline: an image of the company's, never a document or a script. */
const logoFile = (file: LogoFile) =>
  new StreamableFile(file.body, {
    type: file.contentType,
    length: file.body.length,
    disposition: 'inline',
  });

const RECORD_ERRORS = [
  'ENTRY_DATE_OUT_OF_RANGE',
  'PROJECT_FINISHED',
  'CLIENT_HAS_OPEN_DEBT',
  'IDEMPOTENCY_CONFLICT',
  'CASH_BOX_NEGATIVE',
  'CASH_ACCOUNT_INVALID',
  'RATE_MISSING',
  'PERIOD_CLOSED',
  'MATERIAL_REQUIRED',
  'NOT_FOUND',
] as const;

/** `/api/movements` (S13 rules 1–9): the movements, a new one, a cancellation. */
@ApiTags('movements')
@Controller('movements')
export class MovementsController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @ApiQueryFrom(movementQuerySchema)
  @CompanyRoute('entries.read')
  @SerializeOptions({ schema: movementPageSchema })
  @ApiOkResponse({
    description: 'A page of movements, newest first',
    standardSchema: movementPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: movementQuerySchema }) query: MovementQuery,
  ): Promise<MovementPage> {
    return this.movements.movements(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('drafts.manage', 'entries.post')
  @SerializeOptions({ schema: movementSchema })
  @ApiCreatedResponse({ description: 'The movement, posted', standardSchema: movementSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, ...RECORD_ERRORS)
  async record(
    @Access() access: RequestAccess,
    @Body({ schema: recordMovementSchema }) body: RecordMovement,
  ): Promise<Movement> {
    return this.movements.record(inCompany(access), body);
  }

  @Post(':id/cancel')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('entries.post')
  @SerializeOptions({ schema: movementSchema })
  @ApiOkResponse({ description: 'The movement, cancelled', standardSchema: movementSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ENTRY_ALREADY_REVERSED',
    'OPEN_ITEM_HAS_SETTLEMENTS',
    'CASH_BOX_NEGATIVE',
    'REVERSAL_BEFORE_ORIGINAL',
    'PERIOD_CLOSED',
  )
  async cancel(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: cancelMovementSchema }) body: CancelMovement,
  ): Promise<Movement> {
    return this.movements.cancel(inCompany(access), params.id, body);
  }
}

/** `/api/project-books` (S13 "Screens"): the projects with their clients and figures. */
@ApiTags('movements')
@Controller('project-books')
export class ProjectBooksController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @ApiQueryFrom(projectQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectSchema })
  @ApiOkResponse({ description: 'The projects by name', standardSchema: z.array(projectSchema) })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: projectQuerySchema }) query: ProjectQuery,
  ): Promise<Project[]> {
    return this.movements.projects(inCompany(access), query);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectSchema })
  @ApiOkResponse({ description: 'The project with its figures', standardSchema: projectSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND')
  async show(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Project> {
    return this.movements.project(inCompany(access), params.id);
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: projectSchema })
  @ApiCreatedResponse({ description: 'The new project', standardSchema: projectSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DIMENSION_CODE_TAKEN')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createProjectSchema }) body: CreateProject,
  ): Promise<Project> {
    return this.movements.createProject(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: projectSchema })
  @ApiOkResponse({ description: 'The changed project', standardSchema: projectSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateProjectSchema }) body: UpdateProject,
  ): Promise<Project> {
    return this.movements.updateProject(inCompany(access), params.id, body);
  }
}

/** `/api/parties` (S13 "Screens"): clients and suppliers with what is owed each way. */
@ApiTags('movements')
@Controller('parties')
export class PartiesController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @ApiQueryFrom(partyQuerySchema)
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: partySchema })
  @ApiOkResponse({ description: 'The parties by name', standardSchema: z.array(partySchema) })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: partyQuerySchema }) query: PartyQuery,
  ): Promise<Party[]> {
    return this.movements.parties(inCompany(access), query.type);
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: partySchema })
  @ApiCreatedResponse({ description: 'The new party', standardSchema: partySchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'DIMENSION_CODE_TAKEN')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createPartySchema }) body: CreateParty,
  ): Promise<Party> {
    return this.movements.createParty(inCompany(access), body);
  }
}

/** `/api/material-costs` (S13 "Screens"): each material's cost, for all projects or one. */
@ApiTags('movements')
@Controller('material-costs')
export class MaterialCostsController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @ApiQueryFrom(materialCostQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: materialCostsSchema })
  @ApiOkResponse({ description: "The materials' costs", standardSchema: materialCostsSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: materialCostQuerySchema }) query: MaterialCostQuery,
  ): Promise<MaterialCosts> {
    return this.movements.materialCosts(inCompany(access), query);
  }
}

/** `/api/day-rates` (S13 "Currencies"): a day's SYP and TRY per USD, and recording them. */
@ApiTags('movements')
@Controller('day-rates')
export class DayRatesController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @ApiQueryFrom(dayRatesQuerySchema)
  @CompanyRoute('rates.read')
  @SerializeOptions({ schema: dayRatesSchema })
  @ApiOkResponse({ description: "The day's rates", standardSchema: dayRatesSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async show(
    @Access() access: RequestAccess,
    @Query({ schema: dayRatesQuerySchema }) query: DayRatesQuery,
  ): Promise<DayRates> {
    return this.movements.dayRates(inCompany(access), query.date);
  }

  @Post()
  @HttpCode(200)
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: dayRatesSchema })
  @ApiOkResponse({ description: "The day's rates as recorded", standardSchema: dayRatesSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'RATE_UNCHANGED',
    'RATE_REASON_REQUIRED',
    'INVALID_RATE',
    'SYP_BEFORE_REDENOMINATION',
  )
  async record(
    @Access() access: RequestAccess,
    @Body({ schema: recordDayRatesSchema }) body: RecordDayRates,
  ): Promise<DayRates> {
    return this.movements.recordDayRates(inCompany(access), body);
  }
}

/** `/api/dashboard` (S13 "Screens"): the company's figures, boxes, rates and lists. */
@ApiTags('movements')
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: dashboardSchema })
  @ApiOkResponse({ description: 'The dashboard', standardSchema: dashboardSchema })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async show(@Access() access: RequestAccess): Promise<Dashboard> {
    return this.movements.dashboard(inCompany(access));
  }
}

/** `/api/company/branding` (S13 "Data", ADR 0024 §7): the company's display name and logo. */
@ApiTags('movements')
@Controller('company/branding')
export class BrandingController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @CompanyRoute('company.read')
  @SerializeOptions({ schema: brandingSchema })
  @ApiOkResponse({ description: 'The branding', standardSchema: brandingSchema })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async show(@Access() access: RequestAccess): Promise<Branding> {
    return this.movements.branding(inCompany(access));
  }

  @Put()
  @CompanyRoute('company.settings')
  @SerializeOptions({ schema: brandingSchema })
  @ApiOkResponse({ description: 'The branding as saved', standardSchema: brandingSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS)
  async update(
    @Access() access: RequestAccess,
    @Body({ schema: updateBrandingSchema }) body: UpdateBranding,
  ): Promise<Branding> {
    return this.movements.updateBranding(inCompany(access), body);
  }

  @Post('logo')
  @HttpCode(200)
  @CompanyRoute('company.settings')
  @AttachmentUpload()
  @SerializeOptions({ schema: brandingSchema })
  @ApiOkResponse({ description: 'The branding with its new logo', standardSchema: brandingSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'ATTACHMENT_TYPE', 'ATTACHMENT_TOO_LARGE')
  async uploadLogo(
    @Access() access: RequestAccess,
    @UploadedFile() file: UploadedAttachment | undefined,
  ): Promise<Branding> {
    return this.movements.uploadLogo(inCompany(access), file);
  }

  @Get('logo')
  @CompanyRoute('company.read')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  @ApiOkProducesResponse('The logo', LOGO_CONTENT_TYPES)
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND')
  async logo(@Access() access: RequestAccess): Promise<StreamableFile> {
    return logoFile(await this.movements.logo(inCompany(access)));
  }
}

/**
 * `/api/branding/public` (S13 "Data"): the sign-in page's company name and logo, of the one company
 * the server's `SIGN_IN_COMPANY_ID` names; never chosen by the request.
 */
@ApiTags('movements')
@Controller('branding/public')
export class BrandingPublicController {
  constructor(@Inject(MovementsService) private readonly movements: MovementsService) {}

  @Get()
  @Public()
  @SerializeOptions({ schema: brandingSchema })
  @ApiOkResponse({ description: "The sign-in page's branding", standardSchema: brandingSchema })
  async show(): Promise<Branding> {
    return this.movements.publicBranding();
  }

  @Get('logo')
  @Public()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  @ApiOkProducesResponse("The sign-in page's logo", LOGO_CONTENT_TYPES)
  @ApiErrors('NOT_FOUND')
  async logo(): Promise<StreamableFile> {
    return logoFile(await this.movements.publicLogo());
  }
}
