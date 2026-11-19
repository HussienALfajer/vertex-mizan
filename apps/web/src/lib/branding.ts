import { queryOptions } from '@tanstack/react-query';
import { type Branding, brandingSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { useEffect } from 'react';
import { api } from './api';

/**
 * `GET /api/branding/public` (S13 "Data"): the sign-in page's name and logo, of the one company
 * the server names; never one the page chooses.
 */
export const publicBrandingQuery = queryOptions({
  queryKey: ['auth', 'branding'],
  queryFn: () => api('GET', '/branding/public', { schema: brandingSchema }),
  staleTime: 5 * 60_000,
});

/** `GET /api/company/branding`: the active company's display name and logo. */
export function brandingQuery(companyId: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'branding'],
    queryFn: () => api('GET', '/company/branding', { company: companyId, schema: brandingSchema }),
    staleTime: 5 * 60_000,
  });
}

/**
 * The logo's address, or `undefined` without one. Its version names the upload, so a new logo is
 * fetched again rather than taken from the browser's cache.
 */
export function logoUrl(
  branding: Branding | undefined,
  path: '/company/branding/logo' | '/branding/public/logo',
): string | undefined {
  if (!branding?.hasLogo) return undefined;
  const version = branding.logoVersion
    ? `?${new URLSearchParams({ v: branding.logoVersion })}`
    : '';
  return `/api${path}${version}`;
}

/** The name to show: the company's display name, or the product's while it has none. */
export function displayName(branding: Branding | undefined, fallback?: string): string {
  const name = branding?.displayName.trim();
  return name ? name : (fallback ?? ar.common.productName);
}

/**
 * The browser tab shows the company, never the product (ADR 0024 §8): its display name as the
 * page title and, once it has one, its logo as the tab's icon.
 */
export function useCompanyTab(name: string | undefined, logo: string | undefined): void {
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  useEffect(() => {
    if (!logo) return;
    for (const link of document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="apple-touch-icon"]',
    )) {
      link.removeAttribute('type');
      link.href = logo;
    }
  }, [logo]);
}
