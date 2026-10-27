import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger';

/** Documents a route that answers with a file of one of `types`, as a binary body. */
export function ApiOkProducesResponse(description: string, types: readonly string[]) {
  return applyDecorators(
    ApiProduces(...types),
    ApiOkResponse({
      description,
      content: Object.fromEntries(
        types.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    }),
  );
}
