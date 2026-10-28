import {
  type AccountKind,
  type CurrencyCode,
  DomainError,
  type ErrorCode,
} from '@vertex-mizan/contracts';

/**
 * What a line needs from the chart (S02 rule 8): the account it posts to and the dimension values
 * it carries, as the posting function (S03) reads them in its transaction.
 */
export interface ChartAccount {
  readonly id: string;
  readonly kind: AccountKind;
  /** The currency restriction: a line's transaction currency must equal it. */
  readonly currency: CurrencyCode | null;
  readonly blocked: boolean;
  readonly archived: boolean;
  /** A control account, whose lines are open items (S04); no manual line until then. */
  readonly isControl: boolean;
  readonly requiredDimensionTypeIds: readonly string[];
}

/** A dimension value on a line, with its type's code (`client`, `contract`, … for built-ins). */
export interface LineDimensionValue {
  readonly id: string;
  readonly typeId: string;
  readonly typeCode: string;
  /** A contract value's client; null for other types and for a manual contract without one. */
  readonly parentValueId: string | null;
  readonly archived: boolean;
}

/**
 * A line as the chart sees it, by `origin`:
 * - `manual`: a line the accountant typed, or the rounding or difference line of a manual entry;
 * - `hub`: a line a Hub event's posting rule built (S05): Hub is the source of its records, so an
 *   archived value it names is still accepted (rule 13);
 * - `reversal`: a line that negates a posted line exactly (S03 rule 9, ADR 0005 invariant 3). Its
 *   currency, dimensions and account are the original's, which the chart accepted then: a
 *   required dimension added since applies to postings from then on (S02 rule 4) and an archived
 *   value stays, so only the account's state is checked again.
 */
export interface ChartLine {
  /** Undefined when the account id is unknown to the company. */
  readonly account: ChartAccount | undefined;
  /** The line's transaction currency; a difference line keeps its item's (ADR 0007). */
  readonly currency: CurrencyCode;
  readonly dimensions: readonly LineDimensionValue[];
  readonly origin: 'manual' | 'hub' | 'reversal';
}

function refuse(code: ErrorCode, message: string, details: Record<string, unknown>): never {
  throw new DomainError(code, message, details);
}

/**
 * Checks a line against the chart (S02 rule 8), the refusals in this order:
 * - the account is unknown (`NOT_FOUND`), a header (`ACCOUNT_NOT_POSTABLE`), archived
 *   (`ACCOUNT_ARCHIVED`) or blocked (`ACCOUNT_BLOCKED`), whatever the origin;
 * - a manual line on a control account (`ACCOUNT_IS_CONTROL`, S03 rule 16, until S04);
 * - from here on a reversal's line is accepted: it carries a line the chart accepted;
 * - the transaction currency differs from the account's restriction (`ACCOUNT_CURRENCY_MISMATCH`);
 * - two values of one type (`VALIDATION_FAILED`);
 * - a required dimension type has no value (`DIMENSION_REQUIRED`);
 * - an archived value on a manual line (`DIMENSION_VALUE_ARCHIVED`);
 * - a contract whose client is not the line's client value (`DIMENSION_PARENT_MISMATCH`).
 *
 * A line may carry dimensions its account does not require.
 */
export function checkLineAgainstChart(line: ChartLine): void {
  const account = line.account;
  if (account === undefined) refuse('NOT_FOUND', 'Unknown account', {});
  const accountId = account.id;
  if (account.kind !== 'postable') {
    refuse('ACCOUNT_NOT_POSTABLE', `Account ${accountId} is a header`, { accountId });
  }
  if (account.archived)
    refuse('ACCOUNT_ARCHIVED', `Account ${accountId} is archived`, { accountId });
  if (account.blocked) refuse('ACCOUNT_BLOCKED', `Account ${accountId} is blocked`, { accountId });
  if (line.origin === 'manual' && account.isControl) {
    refuse('ACCOUNT_IS_CONTROL', `Account ${accountId} is a control account`, { accountId });
  }
  if (line.origin === 'reversal') return;
  if (account.currency !== null && account.currency !== line.currency) {
    refuse(
      'ACCOUNT_CURRENCY_MISMATCH',
      `Account ${accountId} takes ${account.currency} lines, not ${line.currency}`,
      { accountId, accountCurrency: account.currency, lineCurrency: line.currency },
    );
  }
  const byType = new Map<string, LineDimensionValue>();
  for (const value of line.dimensions) {
    if (byType.has(value.typeId)) {
      refuse('VALIDATION_FAILED', `Two values of dimension type ${value.typeId}`, {
        typeId: value.typeId,
      });
    }
    byType.set(value.typeId, value);
  }
  for (const typeId of account.requiredDimensionTypeIds) {
    if (!byType.has(typeId)) {
      refuse('DIMENSION_REQUIRED', `Account ${accountId} requires dimension type ${typeId}`, {
        accountId,
        typeId,
      });
    }
  }
  if (line.origin === 'manual') {
    for (const value of line.dimensions) {
      if (value.archived) {
        refuse('DIMENSION_VALUE_ARCHIVED', `Dimension value ${value.id} is archived`, {
          valueId: value.id,
        });
      }
    }
  }
  const client = line.dimensions.find((value) => value.typeCode === 'client');
  const contract = line.dimensions.find((value) => value.typeCode === 'contract');
  if (
    client !== undefined &&
    contract !== undefined &&
    contract.parentValueId !== null &&
    contract.parentValueId !== client.id
  ) {
    refuse('DIMENSION_PARENT_MISMATCH', `Contract ${contract.id} belongs to another client`, {
      contractId: contract.id,
      clientId: client.id,
    });
  }
}
