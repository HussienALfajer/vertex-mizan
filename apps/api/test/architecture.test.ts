import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCESS_RULES, type AccessRule } from '../src/core/access/access.js';
import { createTestApp } from './app.js';

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

/** Every route handler of every controller, as `Controller.method`, with its controller's path. */
function routes(): { name: string; handler: object; path: string }[] {
  const found: { name: string; handler: object; path: string }[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const prototype = (wrapper.metatype as { prototype?: object } | null)?.prototype;
      if (!prototype) continue;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function' || key === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const path = String(Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object) ?? '');
        found.push({ name: `${wrapper.name}.${key}`, handler, path });
      }
    }
  }
  return found;
}

// S01 "Rules of the guard": the guard fails closed, and this test fails first, on a route that
// does not declare exactly one of `@Public()`, `@SignedIn()` and `@CompanyRoute()`.
it('gives every route exactly one access decorator', () => {
  const all = routes();
  expect(all.length).toBeGreaterThan(20);
  const wrong = all
    .map(({ name, handler }) => ({
      name,
      rules: (Reflect.getMetadata(ACCESS_RULES, handler) as AccessRule[] | undefined) ?? [],
    }))
    .filter(({ rules }) => rules.length !== 1)
    .map(({ name, rules }) => `${name}: ${rules.length}`);
  expect(wrong).toEqual([]);
});

it('keeps the public routes to the ones the spec names', () => {
  const open = routes()
    .filter(({ handler }) =>
      ((Reflect.getMetadata(ACCESS_RULES, handler) as AccessRule[] | undefined) ?? []).some(
        (rule) => rule.kind === 'public',
      ),
    )
    .map(({ name }) => name)
    .sort();
  expect(open).toEqual([
    'AccountController.requestPasswordReset',
    'AccountController.resetPassword',
    'AuthController.signIn',
    'AuthController.verifyBackupCode',
    'AuthController.verifyTotp',
    'HealthController.check',
    'InvitationsController.accept',
    'InvitationsController.lookup',
  ]);
});

// ADR 0021: Hub's /v1 is gone; every route lives under /api.
it('has no route under /v1', () => {
  expect(routes().filter(({ path }) => path === 'v1' || path.startsWith('v1/'))).toEqual([]);
});
