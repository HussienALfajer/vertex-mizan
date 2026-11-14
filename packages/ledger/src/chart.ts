import {
  type AccountKind,
  type CurrencyCode,
  DomainError,
  type ErrorCode,
  type ItemKind,
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
  /** A control account, whose lines move open items (S04, ADR 0013). */
  readonly isControl: boolean;
  /** The kind of a control account's items; null on any other account. */
  readonly itemKind: ItemKind | null;
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
 * - `reversal`: a line that negates a posted line exactly (S03 rule 9, ADR 0005 invariant 3). Its
 *   currency, dimensions and account are the original's, which the chart accepted then: a
 *   required dimension added since applies to postings from then on (S02 rule 4) and an archived
 *   value stays, so only the account's state is checked again;
 * - `revaluation`: a month-end revaluation's line on a balance, or its reversal's (S07 rules 10,
 *   14): it remeasures a balance the chart accepted, so a blocked account and an archived value are
 *   accepted (owner, 2026-11-11), and only the account's being known, postable and not archived is
 *   checked.
 */
export interface ChartLine {
  /** Undefined when the account id is unknown to the company. */
  readonly account: ChartAccount | undefined;
  /** The line's transaction currency; a difference line keeps its item's (ADR 0007). */
  readonly currency: CurrencyCode;
  readonly dimensions: readonly LineDimensionValue[];
  readonly origin: 'manual' | 'reversal' | 'revaluation';
  /**
   * The open item the line names (S04 rules 5–9): a new document item it opens, or an existing
   * item; undefined when it names none, as a line on a running account, whose item is the client's.
   */
  readonly item?: 'new' | 'existing';
}

function refuse(code: ErrorCode, message: string, details: Record<string, unknown>): never {
  throw new DomainError(code, message, details);
}

/**
 * Checks a line against the chart (S02 rule 8), the refusals in this order:
 * - the account is unknown (`NOT_FOUND`), a header (`ACCOUNT_NOT_POSTABLE`), archived
 *   (`ACCOUNT_ARCHIVED`), whatever the origin, or blocked (`ACCOUNT_BLOCKED`), but on a
 *   revaluation's line;
 * - from here on a reversal's line is accepted: it carries a line the chart accepted;
 * - an item named on an account that is not a control account (`ACCOUNT_NOT_CONTROL`), a line on a
 *   `document` control account that names no item (`OPEN_ITEM_REQUIRED`; S04 rule 5, which
 *   replaces S03 rule 16's `ACCOUNT_IS_CONTROL`), and an item named on a `running` account, whose
 *   item is found by the line's client (`VALIDATION_FAILED`, rule 9);
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
  if (line.origin === 'revaluation') return;
  if (account.blocked) refuse('ACCOUNT_BLOCKED', `Account ${accountId} is blocked`, { accountId });
  if (line.origin === 'reversal') return;
  if (line.item !== undefined && !account.isControl) {
    refuse('ACCOUNT_NOT_CONTROL', `Account ${accountId} is not a control account`, { accountId });
  }
  if (account.itemKind === 'document' && line.item === undefined) {
    refuse('OPEN_ITEM_REQUIRED', `A line on control account ${accountId} names no item`, {
      accountId,
    });
  }
  if (account.itemKind === 'running' && line.item !== undefined) {
    refuse('VALIDATION_FAILED', `A line on running account ${accountId} names only its client`, {
      accountId,
    });
  }
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
