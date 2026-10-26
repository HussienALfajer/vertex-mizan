import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  companySchema,
  createCompanySchema,
  fiscalYearStartMonthSchema,
  reasonSchema,
  updateCompanyLedgersSchema,
  updateCompanyProfileSchema,
} from './companies.js';
import type { CompanyLedgers } from './money.js';

/** The shape S01 pre-fills: book SYP at bulletin; parallel USD at market, accepting the deal rate. */
const sypUsd: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const newCompany = {
  name: '  شركة اختبار  ',
  nameLatin: null,
  ledgers: sypUsd,
  fiscalYearStartMonth: 1,
  policyNote: 'مذكرة سياسة تجريبية.',
};

describe('createCompanySchema', () => {
  it('accepts every currency shape of S01 and trims the names', () => {
    expect(createCompanySchema.parse(newCompany).name).toBe('شركة اختبار');
    const shapes: CompanyLedgers[] = [
      { book: sypUsd.book, parallel: null },
      sypUsd,
      {
        book: {
          currency: 'USD',
          ratePolicy: { rateType: 'market', acceptsTransactionRate: false },
        },
        parallel: {
          currency: 'SYP',
          ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
        },
      },
    ];
    for (const ledgers of shapes) {
      expect(createCompanySchema.safeParse({ ...newCompany, ledgers }).success).toBe(true);
    }
  });

  it('refuses the parallel currency equal to the book currency, and a bulletin policy accepting a deal rate', () => {
    const sameCurrency = { ...sypUsd, parallel: { ...sypUsd.book } };
    expect(createCompanySchema.safeParse({ ...newCompany, ledgers: sameCurrency }).success).toBe(
      false,
    );
    const bulletinWithDealRate = {
      ...sypUsd,
      book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: true } },
    };
    expect(
      createCompanySchema.safeParse({ ...newCompany, ledgers: bulletinWithDealRate }).success,
    ).toBe(false);
  });

  it('refuses an empty name, a currency outside the money module, and an empty or long policy note', () => {
    expect(createCompanySchema.safeParse({ ...newCompany, name: '   ' }).success).toBe(false);
    const yen = { ...sypUsd, book: { ...sypUsd.book, currency: 'JPY' } };
    expect(createCompanySchema.safeParse({ ...newCompany, ledgers: yen }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...newCompany, policyNote: '' }).success).toBe(false);
    expect(
      createCompanySchema.safeParse({ ...newCompany, policyNote: 'م'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('takes a fiscal year start month from 1 to 12', () => {
    expect(fiscalYearStartMonthSchema.safeParse(7).success).toBe(true);
    for (const month of [0, 13, 1.5]) {
      expect(fiscalYearStartMonthSchema.safeParse(month).success).toBe(false);
    }
  });
});

describe('company changes', () => {
  it('change at least one profile field', () => {
    expect(updateCompanyProfileSchema.safeParse({}).success).toBe(false);
    expect(updateCompanyProfileSchema.safeParse({ nameLatin: null }).success).toBe(true);
    expect(updateCompanyProfileSchema.safeParse({ policyNote: 'نص' }).success).toBe(true);
  });

  it('send the ledgers in the money module shape only', () => {
    expect(
      updateCompanyLedgersSchema.safeParse({ ledgers: sypUsd, fiscalYearStartMonth: 1 }).success,
    ).toBe(true);
    expect(
      updateCompanyLedgersSchema.safeParse({ ledgers: { book: 'SYP' }, fiscalYearStartMonth: 1 })
        .success,
    ).toBe(false);
  });

  it('need a written reason to archive or restore', () => {
    expect(reasonSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(reasonSchema.parse({ reason: ' سبب ' }).reason).toBe('سبب');
  });
});

describe('companySchema', () => {
  it('converts to JSON Schema with its id', () => {
    expect(
      companySchema.parse({
        id: '019a2b3c-0000-7000-8000-000000000001',
        name: 'شركة اختبار',
        nameLatin: null,
        ledgers: sypUsd,
        fiscalYearStartMonth: 1,
        policyNote: 'نص',
        booksStarted: false,
        archived: null,
        createdAt: '2026-10-26T09:00:00.000Z',
      }).booksStarted,
    ).toBe(false);
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'Company',
        'CreateCompany',
        'UpdateCompanyProfile',
        'UpdateCompanyLedgers',
        'Reason',
        'PolicyNote',
        'FiscalYearStartMonth',
      ]),
    );
  });
});
