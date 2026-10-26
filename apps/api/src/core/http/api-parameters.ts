import { applyDecorators } from '@nestjs/common';
import { ApiParam, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

type Location = 'query' | 'path';

/**
 * One property's JSON Schema, inline: an empty registry hides the ids of shared schemas, which
 * would otherwise become references to definitions the parameter does not carry.
 */
function propertySchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    metadata: z.registry(),
  }) as Record<string, unknown>;
  return rest;
}

function parameters(location: Location, schema: z.ZodObject) {
  return applyDecorators(
    ...Object.entries(schema.shape).map(([name, property]) => {
      const required = !(property as z.ZodType).safeParse(undefined).success;
      const options = { name, required, schema: propertySchema(property as z.ZodType) };
      return location === 'query' ? ApiQuery(options) : ApiParam(options);
    }),
  );
}

/**
 * Documents a route's query parameters from the contract schema its `@Query({ schema })` checks:
 * Swagger documents a body from its schema, but not the properties of a query or path object.
 */
export const ApiQueryFrom = (schema: z.ZodObject) => parameters('query', schema);

/** Documents a route's path parameters from the schema its `@Param({ schema })` checks. */
export const ApiParamsFrom = (schema: z.ZodObject) => parameters('path', schema);
