import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PARAMTYPES_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Config } from './core/config/config.js';
import { sameOriginOnly } from './core/http/same-origin.js';

/** Every route lives under `/api`. */
export const API_PREFIX = 'api';

/** Settings applied to the application after it is created, in production and in tests alike. */
export function configureApp(app: INestApplication, config: Config): INestApplication {
  app.useLogger(app.get(Logger));
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // nginx on the same host forwards the client address; `request.ip` reads it from loopback only.
  express.set('trust proxy', 'loopback');
  express.use(sameOriginOnly(config.appUrl));
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
  declareParameterTypes(app);
  const config = new DocumentBuilder().setTitle('Vertex Mizan API').setVersion('0.0.0').build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Swagger finds a route's body, query and path parameters through their reflected types, which
 * this build does not emit (no decorator metadata, `apps/api/CLAUDE.md`). Each parameter carries
 * its contract schema (`@Body({ schema })`), so declaring the types as plain objects lets Swagger
 * document the parameters from those schemas.
 */
function declareParameterTypes(app: INestApplication): void {
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const prototype = (wrapper.metatype as { prototype?: object } | null)?.prototype;
      if (!prototype) continue;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function' || key === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        if (Reflect.hasMetadata(PARAMTYPES_METADATA, prototype, key)) continue;
        const types = Array.from({ length: handler.length }, () => Object);
        Reflect.defineMetadata(PARAMTYPES_METADATA, types, prototype, key);
      }
    }
  }
}
