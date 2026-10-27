import type { INestApplication } from '@nestjs/common';
import { companies, type Database } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { expect } from 'vitest';
import { Browser } from './browser.js';
import { joinCompany, newCompany, signedInPerson } from './people.js';

/** A company route as the guard sees it: a read, or a write that carries a body. */
export interface GuardedRoute {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  query?: Record<string, string>;
}

function send(browser: Browser, route: GuardedRoute, headers: Record<string, string> = {}) {
  if (route.method === 'get') return browser.get(route.path, route.query, headers);
  return browser[route.method](route.path, {}, headers);
}

/**
 * The guard's answers on each company route (S01 "Rules of the guard", S02 "Acceptance"): no
 * session `401`; a viewer writing `403`; a page of a company the session left `COMPANY_SWITCHED`;
 * a write to an archived company `COMPANY_ARCHIVED`. Nothing reaches the handler, so the routes
 * need no body or real id.
 */
export async function expectGuarded(
  app: INestApplication,
  db: Database,
  routes: readonly GuardedRoute[],
): Promise<void> {
  const owner = await signedInPerson(app, db);
  const company = await newCompany(owner.browser);
  const viewer = await joinCompany(app, db, company.id, 'viewer');
  const stranger = new Browser(app);
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    expect((await send(stranger, route)).status, label).toBe(401);
    const switched = await send(owner.browser, route, { 'x-mizan-company': uuidv7() });
    expect(switched.body.code, label).toBe('COMPANY_SWITCHED');
    if (route.method !== 'get') {
      expect((await send(viewer.browser, route)).body.code, label).toBe('FORBIDDEN');
    }
  }
  await db
    .update(companies)
    .set({ archivedAt: new Date(), archivedReason: 'شركة اختبار مؤرشفة' })
    .where(eq(companies.id, company.id));
  for (const route of routes) {
    if (route.method === 'get') continue;
    const label = `${route.method} ${route.path}`;
    expect((await send(owner.browser, route)).body.code, label).toBe('COMPANY_ARCHIVED');
  }
}
