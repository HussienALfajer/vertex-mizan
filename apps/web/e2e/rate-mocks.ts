import type { RateCalendar, RatePair, RateRow } from '@vertex-mizan/contracts';
import { companyReads } from './company-mocks';

/** Synthetic answers of the rate API (S02 rules 14–18), shared by the screen and flow specs. */

/** The tests' today: Monday 2026-11-09, mid-morning in Damascus (`page.clock`). */
export const today = new Date('2026-11-09T09:00:00+03:00');

export const usdSyp: RatePair = {
  id: '01900000-0000-7000-8005-000000000001',
  base: 'USD',
  quote: 'SYP',
  createdAt: '2026-10-01T08:00:00.000Z',
};

const person = {
  kind: 'person',
  id: '01900000-0000-7000-8000-000000000001',
  name: 'مستخدم تجريبي',
} as const;
const hub = {
  kind: 'api_client',
  id: '01900000-0000-7000-8006-000000000001',
  name: 'Vertex Hub',
} as const;

let next = 0;
const rateRow = (
  fields: Partial<RateRow> & Pick<RateRow, 'effectiveOn' | 'rate' | 'type'>,
): RateRow => {
  next += 1;
  return {
    id: `01900000-0000-7000-8007-${String(next).padStart(12, '0')}`,
    base: 'USD',
    quote: 'SYP',
    source: 'manual',
    supersedesRateId: null,
    reason: null,
    recordedBy: person,
    superseded: false,
    createdAt: `${fields.effectiveOn}T07:00:00.000Z`,
    ...fields,
  };
};

/** The calendar: Friday and Saturday off, a holiday on Thursday 2026-11-05 (acceptance step 5). */
export const calendar: RateCalendar = {
  daysOff: [5, 6],
  holidays: [
    {
      id: '01900000-0000-7000-8008-000000000001',
      on: '2026-11-05',
      note: 'عطلة تجريبية',
      createdAt: '2026-10-30T08:00:00.000Z',
    },
  ],
};

const wrong = rateRow({
  effectiveOn: '2026-11-04',
  rate: '120',
  type: 'bulletin',
  superseded: true,
});

/** Bulletin rows of the last 30 days, newest first; Sunday 2026-11-08 and Monday the 9th lack one. */
export const bulletinRows: RateRow[] = [
  rateRow({
    effectiveOn: '2026-11-04',
    rate: '121',
    type: 'bulletin',
    supersedesRateId: wrong.id,
    reason: 'تصحيح خطأ إدخال (مثال)',
    createdAt: '2026-11-04T10:00:00.000Z',
  }),
  wrong,
  rateRow({ effectiveOn: '2026-11-03', rate: '119.5', type: 'bulletin' }),
  rateRow({ effectiveOn: '2026-11-02', rate: '119.25', type: 'bulletin' }),
  ...[
    '2026-11-01',
    '2026-10-29',
    '2026-10-28',
    '2026-10-27',
    '2026-10-26',
    '2026-10-25',
    '2026-10-22',
    '2026-10-21',
    '2026-10-20',
    '2026-10-19',
    '2026-10-18',
    '2026-10-15',
    '2026-10-14',
    '2026-10-13',
    '2026-10-12',
    '2026-10-11',
  ].map((effectiveOn) => rateRow({ effectiveOn, rate: '118.75', type: 'bulletin' })),
];

export const marketRows: RateRow[] = [
  rateRow({
    effectiveOn: '2026-11-04',
    rate: '125.5',
    type: 'market',
    source: 'hub',
    recordedBy: hub,
  }),
  rateRow({
    effectiveOn: '2026-10-28',
    rate: '124',
    type: 'market',
    source: 'hub',
    recordedBy: hub,
  }),
];

/** `GET /api/rates`: a pair's rows of a type within the dates asked. */
export function ratesPage(url: URL) {
  const type = url.searchParams.get('type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const rates = (type === 'market' ? marketRows : bulletinRows).filter(
    (row) => (!from || row.effectiveOn >= from) && (!to || row.effectiveOn <= to),
  );
  return { rates, nextCursor: null };
}

/** Every read of the rate pages, answered (with S01's reads). */
export const rateReads = {
  ...companyReads,
  'GET /api/rate-pairs': { status: 200, json: [usdSyp] },
  'GET /api/rate-calendar': { status: 200, json: calendar },
  'GET /api/rates': (request: { url(): string }) => ({
    status: 200,
    json: ratesPage(new URL(request.url())),
  }),
};
