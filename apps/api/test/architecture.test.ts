import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCESS_RULES, type AccessRule } from '../src/core/access/access.js';
import { createTestApp } from './app.js';

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

/** Every route handler of every controller, as `Controller.method`. */
function routes(): { name: string; handler: object }[] {
  const found: { name: string; handler: object }[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const prototype = (wrapper.metatype as { prototype?: object } | null)?.prototype;
      if (!prototype) continue;
      for (const key of Object.getOwnPropertyNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function' || key === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        found.push({ name: `${wrapper.name}.${key}`, handler });
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
    'AuthController.handle',
    'HealthController.check',
    'InvitationsController.accept',
    'InvitationsController.lookup',
  ]);
});
