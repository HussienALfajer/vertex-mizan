import { CURRENCY_CODES, DomainError, type ErrorCode } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ChartAccount,
  type ChartLine,
  checkLineAgainstChart,
  type LineDimensionValue,
} from './chart.js';

// Synthetic ids: types, values and an account of S02's service-agency template's shapes.
const CLIENT_TYPE = 'type-client';
const CONTRACT_TYPE = 'type-contract';
const SERVICE_TYPE = 'type-service';

const client: LineDimensionValue = {
  id: 'client-1',
  typeId: CLIENT_TYPE,
  typeCode: 'client',
  parentValueId: null,
  archived: false,
};
const otherClient: LineDimensionValue = { ...client, id: 'client-2' };
const contract: LineDimensionValue = {
  id: 'contract-1',
  typeId: CONTRACT_TYPE,
  typeCode: 'contract',
  parentValueId: 'client-1',
  archived: false,
};
const service: LineDimensionValue = {
  id: 'service-1',
  typeId: SERVICE_TYPE,
  typeCode: 'service',
  parentValueId: null,
  archived: false,
};

/** Like 213001 (client ad funds held): USD only, requires the client. */
const clientFunds: ChartAccount = {
  id: 'account-213001',
  kind: 'postable',
  currency: 'USD',
  blocked: false,
  archived: false,
  isControl: false,
  requiredDimensionTypeIds: [CLIENT_TYPE],
};

const line = (change: Partial<ChartLine> = {}): ChartLine => ({
  account: clientFunds,
  currency: 'USD',
  dimensions: [client],
  origin: 'manual',
  ...change,
});

function refusal(input: ChartLine): ErrorCode | 'accepted' {
  try {
    checkLineAgainstChart(input);
    return 'accepted';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

describe('checkLineAgainstChart (S02 rule 8)', () => {
  it('accepts a line on a postable account in its currency with its required dimensions', () => {
    expect(refusal(line())).toBe('accepted');
  });

  it('accepts dimensions the account does not require', () => {
    expect(refusal(line({ dimensions: [client, contract, service] }))).toBe('accepted');
  });

  it('refuses an unknown account', () => {
    expect(refusal(line({ account: undefined }))).toBe('NOT_FOUND');
  });

  it('refuses a header account', () => {
    expect(refusal(line({ account: { ...clientFunds, kind: 'header' } }))).toBe(
      'ACCOUNT_NOT_POSTABLE',
    );
  });

  it('refuses an archived account, and a blocked one', () => {
    expect(refusal(line({ account: { ...clientFunds, archived: true } }))).toBe('ACCOUNT_ARCHIVED');
    expect(refusal(line({ account: { ...clientFunds, blocked: true } }))).toBe('ACCOUNT_BLOCKED');
    expect(refusal(line({ account: { ...clientFunds, blocked: true }, origin: 'hub' }))).toBe(
      'ACCOUNT_BLOCKED',
    );
  });

  it('refuses a manual line on a control account and accepts a Hub line on one (S03 rule 16)', () => {
    const control = { ...clientFunds, isControl: true };
    expect(refusal(line({ account: control }))).toBe('ACCOUNT_IS_CONTROL');
    expect(refusal(line({ account: control, origin: 'hub' }))).toBe('accepted');
  });

  it("accepts a reversal's line as posted, and refuses it on an account now blocked or archived", () => {
    const archived = { ...client, archived: true };
    // The account required no dimension when the original posted (S02 rule 4).
    expect(refusal(line({ dimensions: [], origin: 'reversal' }))).toBe('accepted');
    expect(refusal(line({ dimensions: [archived], origin: 'reversal' }))).toBe('accepted');
    expect(
      refusal(line({ account: { ...clientFunds, isControl: true }, origin: 'reversal' })),
    ).toBe('accepted');
    expect(refusal(line({ account: { ...clientFunds, blocked: true }, origin: 'reversal' }))).toBe(
      'ACCOUNT_BLOCKED',
    );
    expect(refusal(line({ account: { ...clientFunds, archived: true }, origin: 'reversal' }))).toBe(
      'ACCOUNT_ARCHIVED',
    );
    expect(refusal(line({ account: undefined, origin: 'reversal' }))).toBe('NOT_FOUND');
  });

  it('refuses a transaction currency other than the restriction, and accepts any without one', () => {
    expect(refusal(line({ currency: 'SYP' }))).toBe('ACCOUNT_CURRENCY_MISMATCH');
    expect(refusal(line({ currency: 'SYP', account: { ...clientFunds, currency: null } }))).toBe(
      'accepted',
    );
  });

  it('refuses two values of one type', () => {
    expect(refusal(line({ dimensions: [client, otherClient] }))).toBe('VALIDATION_FAILED');
  });

  it('refuses a missing required dimension', () => {
    expect(refusal(line({ dimensions: [] }))).toBe('DIMENSION_REQUIRED');
    expect(refusal(line({ dimensions: [service] }))).toBe('DIMENSION_REQUIRED');
  });

  it('refuses an archived value on a manual line and accepts it on a Hub line (rule 13)', () => {
    const archived = { ...client, archived: true };
    expect(refusal(line({ dimensions: [archived] }))).toBe('DIMENSION_VALUE_ARCHIVED');
    expect(refusal(line({ dimensions: [archived], origin: 'hub' }))).toBe('accepted');
  });

  it("refuses a contract of another client than the line's", () => {
    expect(refusal(line({ dimensions: [otherClient, contract] }))).toBe(
      'DIMENSION_PARENT_MISMATCH',
    );
    expect(refusal(line({ dimensions: [otherClient, contract], origin: 'hub' }))).toBe(
      'DIMENSION_PARENT_MISMATCH',
    );
  });

  it('accepts a contract without a client, and a contract alone', () => {
    const manualContract = { ...contract, parentValueId: null };
    expect(refusal(line({ dimensions: [otherClient, manualContract] }))).toBe('accepted');
    const contractAccount = { ...clientFunds, requiredDimensionTypeIds: [CONTRACT_TYPE] };
    expect(refusal(line({ account: contractAccount, dimensions: [contract] }))).toBe('accepted');
  });
});

describe('checkLineAgainstChart properties', () => {
  const types = ['type-a', 'type-b', 'type-c', 'type-d', 'type-e'];
  const accounts = fc.record({
    id: fc.constant('account'),
    kind: fc.constant('postable' as const),
    currency: fc.option(fc.constantFrom(...CURRENCY_CODES), { nil: null }),
    blocked: fc.constant(false),
    archived: fc.constant(false),
    isControl: fc.constant(false),
    requiredDimensionTypeIds: fc.subarray(types),
  });
  const liveValue = (typeId: string, archived = false): LineDimensionValue => ({
    id: `value-${typeId}`,
    typeId,
    typeCode: typeId,
    parentValueId: null,
    archived,
  });

  it('accepts every line with one live value per required type, whatever else it carries', () => {
    fc.assert(
      fc.property(
        accounts,
        fc.subarray(types),
        fc.constantFrom(...CURRENCY_CODES),
        (account, extra, other) => {
          const typeIds = [...new Set([...account.requiredDimensionTypeIds, ...extra])];
          const input: ChartLine = {
            account,
            currency: account.currency ?? other,
            dimensions: typeIds.map((typeId) => liveValue(typeId)),
            origin: 'manual',
          };
          expect(refusal(input)).toBe('accepted');
        },
      ),
    );
  });

  it('refuses a line missing any one required type with DIMENSION_REQUIRED', () => {
    fc.assert(
      fc.property(
        accounts.filter((account) => account.requiredDimensionTypeIds.length > 0),
        fc.nat(),
        (account, pick) => {
          const missing =
            account.requiredDimensionTypeIds[pick % account.requiredDimensionTypeIds.length];
          const input: ChartLine = {
            account,
            currency: account.currency ?? 'USD',
            dimensions: account.requiredDimensionTypeIds
              .filter((typeId) => typeId !== missing)
              .map((typeId) => liveValue(typeId)),
            origin: 'manual',
          };
          expect(refusal(input)).toBe('DIMENSION_REQUIRED');
        },
      ),
    );
  });

  it('never accepts a line on a blocked, archived or header account, from any origin', () => {
    fc.assert(
      fc.property(
        accounts,
        fc.constantFrom('blocked', 'archived', 'header'),
        fc.constantFrom('manual' as const, 'hub' as const, 'reversal' as const),
        (account, state, origin) => {
          const broken: ChartAccount =
            state === 'header' ? { ...account, kind: 'header' } : { ...account, [state]: true };
          const input: ChartLine = {
            account: broken,
            currency: account.currency ?? 'USD',
            dimensions: account.requiredDimensionTypeIds.map((typeId) => liveValue(typeId)),
            origin,
          };
          expect(refusal(input)).not.toBe('accepted');
        },
      ),
    );
  });
});
