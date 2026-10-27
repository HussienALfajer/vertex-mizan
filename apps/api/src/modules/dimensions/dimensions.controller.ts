import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateDimensionType,
  type CreateDimensionValue,
  createDimensionTypeSchema,
  createDimensionValueSchema,
  type DimensionType,
  type DimensionValue,
  type DimensionValuePage,
  type DimensionValueQuery,
  dimensionTypeSchema,
  dimensionValuePageSchema,
  dimensionValueQuerySchema,
  dimensionValueSchema,
  type IdParam,
  idParamSchema,
  type LinkDimensionValue,
  linkDimensionValueSchema,
  type UpdateDimensionType,
  type UpdateDimensionValue,
  updateDimensionTypeSchema,
  updateDimensionValueSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { DimensionsService } from './dimensions.service.js';

/** `/api/dimension-types`: built-in and custom types (S02 rule 9). */
@ApiTags('dimensions')
@Controller('dimension-types')
export class DimensionTypesController {
  constructor(@Inject(DimensionsService) private readonly dimensions: DimensionsService) {}

  @Get()
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: dimensionTypeSchema })
  @ApiOkResponse({
    description: 'Every type in position order',
    standardSchema: z.array(dimensionTypeSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<DimensionType[]> {
    return this.dimensions.types(inCompany(access));
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionTypeSchema })
  @ApiCreatedResponse({ description: 'The new custom type', standardSchema: dimensionTypeSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'DIMENSION_TYPE_LIMIT', 'DIMENSION_CODE_TAKEN')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createDimensionTypeSchema }) body: CreateDimensionType,
  ): Promise<DimensionType> {
    return this.dimensions.createType(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionTypeSchema })
  @ApiOkResponse({ description: 'The changed type', standardSchema: dimensionTypeSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateDimensionTypeSchema }) body: UpdateDimensionType,
  ): Promise<DimensionType> {
    return this.dimensions.updateType(inCompany(access), params.id, body);
  }

  @Post(':id/archive')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionTypeSchema })
  @ApiOkResponse({ description: 'The archived type', standardSchema: dimensionTypeSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DIMENSION_TYPE_IN_USE')
  async archive(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<DimensionType> {
    return this.dimensions.archiveType(inCompany(access), params.id);
  }

  @Post(':id/restore')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionTypeSchema })
  @ApiOkResponse({ description: 'The restored type', standardSchema: dimensionTypeSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'DIMENSION_TYPE_LIMIT')
  async restore(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<DimensionType> {
    return this.dimensions.restoreType(inCompany(access), params.id);
  }
}

/** `/api/dimension-values`: values from Hub or added by hand (S02 rules 10–13). */
@ApiTags('dimensions')
@Controller('dimension-values')
export class DimensionValuesController {
  constructor(@Inject(DimensionsService) private readonly dimensions: DimensionsService) {}

  @Get()
  @ApiQueryFrom(dimensionValueQuerySchema)
  @CompanyRoute('dimensions.read')
  @SerializeOptions({ schema: dimensionValuePageSchema })
  @ApiOkResponse({ description: 'A page of values', standardSchema: dimensionValuePageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND', 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: dimensionValueQuerySchema }) query: DimensionValueQuery,
  ): Promise<DimensionValuePage> {
    return this.dimensions.values(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionValueSchema })
  @ApiCreatedResponse({ description: 'The new value', standardSchema: dimensionValueSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DIMENSION_CODE_TAKEN',
    'DIMENSION_PARENT_MISMATCH',
  )
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createDimensionValueSchema }) body: CreateDimensionValue,
  ): Promise<DimensionValue> {
    return this.dimensions.createValue(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionValueSchema })
  @ApiOkResponse({ description: 'The changed value', standardSchema: dimensionValueSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DIMENSION_CODE_TAKEN',
    'DIMENSION_PARENT_MISMATCH',
  )
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateDimensionValueSchema }) body: UpdateDimensionValue,
  ): Promise<DimensionValue> {
    return this.dimensions.updateValue(inCompany(access), params.id, body);
  }

  @Post(':id/link')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionValueSchema })
  @ApiOkResponse({
    description: 'The value, linked to its Hub ID',
    standardSchema: dimensionValueSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'DIMENSION_ALREADY_LINKED',
    'DIMENSION_LINK_TAKEN',
  )
  async link(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: linkDimensionValueSchema }) body: LinkDimensionValue,
  ): Promise<DimensionValue> {
    return this.dimensions.link(inCompany(access), params.id, body.externalId);
  }

  @Post(':id/archive')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionValueSchema })
  @ApiOkResponse({ description: 'The archived value', standardSchema: dimensionValueSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async archive(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<DimensionValue> {
    return this.dimensions.archiveValue(inCompany(access), params.id);
  }

  @Post(':id/restore')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('dimensions.manage')
  @SerializeOptions({ schema: dimensionValueSchema })
  @ApiOkResponse({ description: 'The restored value', standardSchema: dimensionValueSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async restore(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<DimensionValue> {
    return this.dimensions.restoreValue(inCompany(access), params.id);
  }
}
