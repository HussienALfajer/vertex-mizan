import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateMaterial,
  type CreateSubcontract,
  createMaterialSchema,
  createSubcontractSchema,
  type IdParam,
  idParamSchema,
  type Material,
  type MaterialPage,
  type MaterialQuery,
  materialPageSchema,
  materialQuerySchema,
  materialSchema,
  type ProjectDocument,
  type ProjectDocumentPage,
  type ProjectDocumentQuery,
  type ProjectParams,
  type ProjectTermsInput,
  type ProjectTermsView,
  projectDocumentPageSchema,
  projectDocumentQuerySchema,
  projectDocumentSchema,
  projectParamsSchema,
  projectTermsInputSchema,
  projectTermsViewSchema,
  type Subcontract,
  type SubcontractList,
  type SubcontractQuery,
  subcontractListSchema,
  subcontractQuerySchema,
  subcontractSchema,
  type UpdateMaterial,
  type UpdateSubcontract,
  updateMaterialSchema,
  updateSubcontractSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { ProjectsService } from './projects.service.js';

/** `/api/materials` (S12 rule 3): the materials catalogue. */
@ApiTags('projects')
@Controller('materials')
export class MaterialsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  @ApiQueryFrom(materialQuerySchema)
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: materialPageSchema })
  @ApiOkResponse({ description: 'A page of materials by code', standardSchema: materialPageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: materialQuerySchema }) query: MaterialQuery,
  ): Promise<MaterialPage> {
    return this.projects.materials(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: materialSchema })
  @ApiCreatedResponse({ description: 'The new material', standardSchema: materialSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'DIMENSION_CODE_TAKEN')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createMaterialSchema }) body: CreateMaterial,
  ): Promise<Material> {
    return this.projects.createMaterial(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: materialSchema })
  @ApiOkResponse({ description: 'The changed material', standardSchema: materialSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DIMENSION_CODE_TAKEN', 'MATERIAL_LOCKED')
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateMaterialSchema }) body: UpdateMaterial,
  ): Promise<Material> {
    return this.projects.updateMaterial(inCompany(access), params.id, body);
  }

  @Post(':id/archive')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: materialSchema })
  @ApiOkResponse({ description: 'The archived material', standardSchema: materialSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async archive(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Material> {
    return this.projects.archiveMaterial(inCompany(access), params.id);
  }
}

/** `/api/projects/:valueId/terms` (S12 rule 1, answer 8): a project's terms and budget. */
@ApiTags('projects')
@Controller('projects')
export class ProjectTermsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get(':valueId/terms')
  @ApiParamsFrom(projectParamsSchema)
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: projectTermsViewSchema })
  @ApiOkResponse({
    description: 'The project and its terms',
    standardSchema: projectTermsViewSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND')
  async terms(
    @Access() access: RequestAccess,
    @Param({ schema: projectParamsSchema }) params: ProjectParams,
  ): Promise<ProjectTermsView> {
    return this.projects.terms(inCompany(access), params.valueId);
  }

  @Put(':valueId/terms')
  @ApiParamsFrom(projectParamsSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: projectTermsViewSchema })
  @ApiOkResponse({ description: 'The terms as saved', standardSchema: projectTermsViewSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'PROJECT_TERMS_LOCKED')
  async putTerms(
    @Access() access: RequestAccess,
    @Param({ schema: projectParamsSchema }) params: ProjectParams,
    @Body({ schema: projectTermsInputSchema }) body: ProjectTermsInput,
  ): Promise<ProjectTermsView> {
    return this.projects.putTerms(inCompany(access), params.valueId, body);
  }
}

/** `/api/subcontracts` (S12 rule 2): a project's subcontracts. */
@ApiTags('projects')
@Controller('subcontracts')
export class SubcontractsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  @ApiQueryFrom(subcontractQuerySchema)
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: subcontractListSchema })
  @ApiOkResponse({ description: 'The subcontracts', standardSchema: subcontractListSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: subcontractQuerySchema }) query: SubcontractQuery,
  ): Promise<SubcontractList> {
    return this.projects.subcontracts(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: subcontractSchema })
  @ApiCreatedResponse({ description: 'The new subcontract', standardSchema: subcontractSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createSubcontractSchema }) body: CreateSubcontract,
  ): Promise<Subcontract> {
    return this.projects.createSubcontract(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: subcontractSchema })
  @ApiOkResponse({ description: 'The changed subcontract', standardSchema: subcontractSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'PROJECT_TERMS_LOCKED')
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateSubcontractSchema }) body: UpdateSubcontract,
  ): Promise<Subcontract> {
    return this.projects.updateSubcontract(inCompany(access), params.id, body);
  }
}

/** `/api/project-documents` (S12 "API"): the register of project documents and a document. */
@ApiTags('projects')
@Controller('project-documents')
export class ProjectDocumentsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  @ApiQueryFrom(projectDocumentQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectDocumentPageSchema })
  @ApiOkResponse({
    description: 'A page of project documents, newest first',
    standardSchema: projectDocumentPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: projectDocumentQuerySchema }) query: ProjectDocumentQuery,
  ): Promise<ProjectDocumentPage> {
    return this.projects.documents(inCompany(access), query);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectDocumentSchema })
  @ApiOkResponse({
    description: 'The document with its entry, quantities and covered parts',
    standardSchema: projectDocumentSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<ProjectDocument> {
    return this.projects.document(inCompany(access), params.id);
  }
}
