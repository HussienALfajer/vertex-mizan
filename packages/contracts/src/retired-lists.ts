// The append-only lists of the event inbox as Hub's integration published them (S05, ADR 0014):
// the hold reasons and their details, the event states and actions, the posting slots and the
// document types. ADR 0021 removed the inbox; the lists stay here, retired, so no value is ever
// renamed, removed or reused (`pnpm check:error-codes` guards them as it guards the error codes).
// Nothing reads them.

export const HOLD_REASONS = [
  'PERIOD_CLOSED',
  'SERVICE_PERIOD_CLOSED',
  'UNKNOWN_REFERENCE',
  'NO_MAPPING',
  'RATE_MISSING',
  'NEEDS_DECISION',
  'OPEN_ITEM_HAS_SETTLEMENTS',
  'WAITING_FOR_EARLIER_EVENT',
] as const;

export const HOLD_DETAILS = [
  'deferred_revenue',
  'tax_lines',
  'payment_exceeds_open',
  'amount_above_applied',
  'payment_gap_beyond_tolerance',
  'wallet_gap_beyond_tolerance',
  'contract_client_mismatch',
  'dimension_value_archived',
  'document_resolved_manually',
  'invoice_currency_mismatch',
  // S06 rule 18: recognition's holds; `recognition_pattern_unclear:<line position>`.
  'recognition_pattern_unclear',
  'credit_cycle',
  'credit_cycle_voided',
  'credit_exceeds_cycle',
  'schedule_credited',
  'milestone_amount_differs',
  'milestone_already_done',
  'milestone_service_missing',
  'milestone_released_at_completion',
  'reissue_period_differs',
  'cancelled_project_remainder',
  'schedule_split_at_cancellation',
  'invoiced_after_cancellation',
  // A credit or a credit's void after a change of its cycle dated later (owner, 2026-11-11).
  'credit_after_later_change',
  // S10 rule 28: a void, change, archive or reopen of a document only the opening carries.
  'before_books_start',
] as const;

export const EVENT_STATES = ['held', 'posted', 'recorded', 'resolved', 'dismissed'] as const;

export const EVENT_ACTIONS = [
  'received',
  'replayed',
  'attempted',
  'held',
  'posted',
  'recorded',
  'retried',
  'moved_to_open_period',
  'resolved',
  'dismissed',
  // S06 rule 16: the accountant's recognition actions.
  'recognised_in_open_period',
  'remainder_split',
] as const;

export const POSTING_SLOTS = [
  'receivable',
  'revenue_at_issue',
  'termination_fee_revenue',
  'payment_method.cash',
  'payment_method.bank_transfer',
  'payment_method.e_wallet',
  'ad_funds',
  'ad_platforms_payable',
  'project_cost',
  'project_expense_awaiting_payment',
  // S06 "Data": revenue recognition.
  'contract_liability',
  'contract_asset',
  'released_revenue',
  'cancelled_project_refund',
] as const;

export const DOCUMENT_TYPES = [
  'invoice',
  'payment',
  'project_expense',
  'ad_wallet_entry',
  'ad_spend',
  'milestone',
  'project',
  'rate',
] as const;
