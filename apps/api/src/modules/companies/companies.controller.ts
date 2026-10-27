import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Company,
  type CreateCompany,
  companySchema,
  createCompanySchema,
  type Reason,
  reasonSchema,
  type UpdateCompanyLedgers,
  type UpdateCompanyProfile,
  updateCompanyLedgersSchema,
  updateCompanyProfileSchema,
} from '@vertex-mizan/contracts';
import {
  Access,
  CompanyRoute,
  inCompany,
  Reauthenticated,
  type RequestAccess,
  SignedIn,
  signedIn,
  WhileArchived,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { CompaniesService } from './companies.service.js';

/** `POST /api/companies`: any person with two-factor enrolled creates a company and owns it. */
@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @Post()
  @SignedIn()
  @SerializeOptions({ schema: companySchema })
  @ApiCreatedResponse({ description: 'The new company', standardSchema: companySchema })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'VALIDATION_FAILED')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createCompanySchema }) body: CreateCompany,
  ): Promise<Company> {
    return this.companies.create(signedIn(access), body);
  }
}

/** `/api/company`: the session's active company, its profile, ledgers and archive. */
@ApiTags('companies')
@Controller('company')
export class CompanyController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @Get()
  @CompanyRoute('company.read')
  @SerializeOptions({ schema: companySchema })
  @ApiOkResponse({ description: 'The active company', standardSchema: companySchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SWITCHED',
  )
  async get(@Access() access: RequestAccess): Promise<Company> {
    return this.companies.get(inCompany(access));
  }

  @Patch()
  @CompanyRoute('company.settings')
  @SerializeOptions({ schema: companySchema })
  @ApiOkResponse({ description: 'The changed company', standardSchema: companySchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SWITCHED',
    'COMPANY_ARCHIVED',
    'VALIDATION_FAILED',
  )
  async updateProfile(
    @Access() access: RequestAccess,
    @Body({ schema: updateCompanyProfileSchema }) body: UpdateCompanyProfile,
  ): Promise<Company> {
    return this.companies.updateProfile(inCompany(access), body);
  }

  @Put('ledgers')
  @CompanyRoute('company.settings')
  @Reauthenticated()
  @SerializeOptions({ schema: companySchema })
  @ApiOkResponse({ description: 'The company with its new ledgers', standardSchema: companySchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SETTINGS_LOCKED',
    'COMPANY_SWITCHED',
    'COMPANY_ARCHIVED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async updateLedgers(
    @Access() access: RequestAccess,
    @Body({ schema: updateCompanyLedgersSchema }) body: UpdateCompanyLedgers,
  ): Promise<Company> {
    return this.companies.updateLedgers(inCompany(access), body);
  }

  @Post('archive')
  @HttpCode(200)
  @CompanyRoute('company.archive')
  @WhileArchived()
  @Reauthenticated()
  @SerializeOptions({ schema: companySchema })
  @ApiOkResponse({ description: 'The archived company', standardSchema: companySchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async archive(
    @Access() access: RequestAccess,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<Company> {
    return this.companies.archive(inCompany(access), body.reason);
  }

  @Post('restore')
  @HttpCode(200)
  @CompanyRoute('company.archive')
  @WhileArchived()
  @Reauthenticated()
  @SerializeOptions({ schema: companySchema })
  @ApiOkResponse({ description: 'The restored company', standardSchema: companySchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async restore(
    @Access() access: RequestAccess,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<Company> {
    return this.companies.restore(inCompany(access), body.reason);
  }
}
