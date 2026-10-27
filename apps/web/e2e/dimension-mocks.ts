import type { DimensionType, DimensionValue } from '@vertex-mizan/contracts';
import { chartReads, dimensionTypes } from './chart-mocks';

/** Synthetic answers of the dimension API (S02 rules 9–13), shared by the screen and flow specs. */

export const typeOf = (code: string): DimensionType => {
  const found = dimensionTypes.find((type) => type.code === code);
  if (!found) throw new Error(`No dimension type ${code} in the mocks`);
  return found;
};

const created = '2026-10-21T08:00:00.000Z';
const valueId = (n: number) => `01900000-0000-7000-8004-${String(n).padStart(12, '0')}`;

const value = (
  n: number,
  fields: Partial<DimensionValue> & Pick<DimensionValue, 'typeId' | 'name'>,
) =>
  ({
    id: valueId(n),
    code: null,
    nameLatin: null,
    contractKind: null,
    parentValueId: null,
    parentName: null,
    externalSource: null,
    externalId: null,
    archivedAt: null,
    createdAt: created,
    ...fields,
  }) satisfies DimensionValue;

/** A manual client (acceptance step 4), a Hub client and an archived one. */
export const manualClient = value(1, {
  typeId: typeOf('client').id,
  code: 'C-001',
  name: 'عميل تجريبي',
  nameLatin: 'Sample Client',
});
export const hubClient = value(2, {
  typeId: typeOf('client').id,
  name: 'شركة تجريبية للتسويق',
  externalSource: 'hub',
  externalId: '01900000-0000-7000-9000-000000000001',
});
export const archivedClient = value(3, {
  typeId: typeOf('client').id,
  name: 'عميل مؤرشف تجريبي',
  archivedAt: '2026-10-25T08:00:00.000Z',
});
export const hubContract = value(4, {
  typeId: typeOf('contract').id,
  name: 'حملة تجريبية',
  contractKind: 'retainer',
  parentValueId: hubClient.id,
  parentName: hubClient.name,
  externalSource: 'hub',
  externalId: '01900000-0000-7000-9000-000000000002',
});

export const clients = [manualClient, hubClient];

/** `GET /api/dimension-values`: one type's page, archived values on request. */
export function valuesPage(url: URL) {
  const typeId = url.searchParams.get('typeId');
  const includeArchived = url.searchParams.get('includeArchived') === 'true';
  const q = url.searchParams.get('q');
  const values = [manualClient, hubClient, archivedClient, hubContract].filter(
    (candidate) =>
      candidate.typeId === typeId &&
      (includeArchived || candidate.archivedAt === null) &&
      (!q || candidate.name.includes(q) || candidate.code?.includes(q)),
  );
  return { values, nextCursor: null };
}

/** Every read of the dimensions page, answered (with the chart's and S01's reads). */
export const dimensionReads = {
  ...chartReads,
  'GET /api/dimension-values': (request: { url(): string }) => ({
    status: 200,
    json: valuesPage(new URL(request.url())),
  }),
};
