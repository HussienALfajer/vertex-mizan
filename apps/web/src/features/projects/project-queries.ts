import { infiniteQueryOptions, queryOptions, useQuery } from '@tanstack/react-query';
import {
  type Material,
  type MaterialPage,
  materialPageSchema,
  materialQuantitiesSchema,
  type ProjectDocumentQuery,
  projectDocumentPageSchema,
  projectDocumentSchema,
  projectListSchema,
  projectReportSchema,
  projectTermsViewSchema,
  subcontractListSchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { type ReportParams, searchOf } from '../reports/reports-queries';

/*
 * The project screens' reads (S12 "API"). The master data (materials, terms, subcontracts) and the
 * documents sit under `['projects', companyId, …]`, so a save or a posting drops them together; the
 * project list, report and material quantities are reports, under `['reports', companyId, …]`.
 */

/** Every material of the catalogue, archived ones included, read page by page. */
export function allMaterialsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['projects', companyId, 'materials', 'all'],
    queryFn: async () => {
      const materials: Material[] = [];
      let cursor: string | null = null;
      do {
        const page: MaterialPage = await api(
          'GET',
          `/materials${searchOf({ archived: 'true', cursor: cursor ?? undefined })}`,
          { company: companyId, schema: materialPageSchema },
        );
        materials.push(...page.materials);
        cursor = page.nextCursor;
      } while (cursor);
      return materials;
    },
  });
}

/**
 * The catalogue's materials by id, every one, for naming a line's material; read only when
 * `enabled` (a screen whose lines name none never asks).
 */
export function useMaterials(companyId: string, enabled = true) {
  const query = useQuery({ ...allMaterialsQuery(companyId), enabled });
  const all = query.data ?? [];
  return { query, all, byId: new Map(all.map((material) => [material.id, material])) };
}

/** `GET /api/materials`: a page of the catalogue by code, searched, archived on request. */
export function materialsQuery(companyId: string, filters: { q?: string; archived?: boolean }) {
  return infiniteQueryOptions({
    queryKey: ['projects', companyId, 'materials', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        'GET',
        `/materials${searchOf({
          q: filters.q,
          archived: filters.archived ? 'true' : undefined,
          cursor: pageParam,
        })}`,
        { company: companyId, schema: materialPageSchema },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/projects/:valueId/terms`: the project and its terms, null until set. */
export function projectTermsQuery(companyId: string, valueId: string) {
  return queryOptions({
    queryKey: ['projects', companyId, 'terms', valueId],
    queryFn: () =>
      api('GET', `/projects/${valueId}/terms`, {
        company: companyId,
        schema: projectTermsViewSchema,
      }),
    retry: false,
  });
}

/** `GET /api/subcontracts`: a project's or a supplier's subcontracts, archived ones included. */
export function subcontractsQuery(
  companyId: string,
  filters: { contract?: string | undefined; supplier?: string | undefined },
) {
  return queryOptions({
    queryKey: ['projects', companyId, 'subcontracts', filters],
    queryFn: () =>
      api('GET', `/subcontracts${searchOf({ ...filters, archived: 'true' })}`, {
        company: companyId,
        schema: subcontractListSchema,
      }),
  });
}

/** `GET /api/project-documents`: the register, newest first, a page of 100 at a time. */
export function projectDocumentsQuery(
  companyId: string,
  filters: Omit<ProjectDocumentQuery, 'cursor'>,
) {
  return infiniteQueryOptions({
    queryKey: ['projects', companyId, 'documents', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('GET', `/project-documents${searchOf({ ...filters, cursor: pageParam })}`, {
        company: companyId,
        schema: projectDocumentPageSchema,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/project-documents/:id`: the document with its entry, quantities and applications. */
export function projectDocumentQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['projects', companyId, 'document', id],
    queryFn: () =>
      api('GET', `/project-documents/${id}`, { company: companyId, schema: projectDocumentSchema }),
  });
}

/** `GET /api/projects`: every project's figures at a date in a ledger. */
export function projectListQuery(companyId: string, params: ReportParams) {
  return queryOptions({
    queryKey: ['reports', companyId, 'projects', params],
    queryFn: () =>
      api('GET', `/projects${searchOf(params)}`, { company: companyId, schema: projectListSchema }),
    retry: false,
  });
}

/** `GET /api/projects/:valueId/report`: a project's report over a range in a ledger. */
export function projectReportQuery(companyId: string, valueId: string, params: ReportParams) {
  return queryOptions({
    queryKey: ['reports', companyId, 'project', valueId, params],
    queryFn: () =>
      api('GET', `/projects/${valueId}/report${searchOf(params)}`, {
        company: companyId,
        schema: projectReportSchema,
      }),
    retry: false,
  });
}

/** `GET /api/reports/material-quantities`. */
export function materialQuantitiesQuery(companyId: string, params: ReportParams) {
  return queryOptions({
    queryKey: ['reports', companyId, 'material-quantities', params],
    queryFn: () =>
      api('GET', `/reports/material-quantities${searchOf(params)}`, {
        company: companyId,
        schema: materialQuantitiesSchema,
      }),
    retry: false,
  });
}
