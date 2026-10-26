import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Config } from './core/config/config.js';

/** Every route lives under `/api`. */
export const API_PREFIX = 'api';

/** Settings applied to the application after it is created, in production and in tests alike. */
export function configureApp(app: INestApplication, config: Config): INestApplication {
  app.useLogger(app.get(Logger));
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  if (config.environment !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, createOpenApiDocument(app));
  }
  return app;
}

/**
 * The OpenAPI document, generated from the contract schemas on each route. Committed as
 * `apps/api/openapi.json` (`test/openapi.test.ts`); CI refuses a breaking change to it (ADR 0006).
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('Vertex Mizan API').setVersion('0.0.0').build();
  return SwaggerModule.createDocument(app, config);
}
