import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditQuerySchema, COMPANY_AUDIT_ACTIONS, PLATFORM_AUDIT_ACTIONS } from './audit.js';

describe('audit actions', () => {
  // Stored values: a later spec appends, never renames (S01, "Audit").
  it('are the platform and company actions of S01 to S10, as <entity>.<verb>', () => {
    expect(PLATFORM_AUDIT_ACTIONS).toHaveLength(11);
    expect(COMPANY_AUDIT_ACTIONS).toHaveLength(89);
    expect(COMPANY_AUDIT_ACTIONS.slice(15, 17)).toEqual(['account.created', 'account.updated']);
    expect(COMPANY_AUDIT_ACTIONS.slice(38, 41)).toEqual([
      'export.chart',
      'entry.posted',
      'draft.created',
    ]);
    expect(COMPANY_AUDIT_ACTIONS.slice(-40, -17)).toEqual([
      'company.settings_updated',
      'integrity.checked',
      'export.requested',
      'export.downloaded',
      'open_item.due_date_changed',
      'export.ageing',
      'export.client_statement',
      'api_client.created',
      'api_client.updated',
      'api_client_key.created',
      'api_client_key.revoked',
      'document_source.set',
      'posting_rule.mapped',
      'event.retried',
      'event.moved_to_open_period',
      'event.resolved',
      'event.dismissed',
      'event.recognised_in_open_period',
      'event.remainder_split',
      'revaluation.posted',
      'period.closed',
      'period.reopened',
      'service_department.set',
    ]);
    expect(COMPANY_AUDIT_ACTIONS.slice(-17)).toEqual([
      'export.trial_balance',
      'export.general_ledger',
      'export.account_statement',
      'export.journal_book',
      'export.income_statement',
      'export.balance_sheet',
      'export.profitability',
      'export.contract_position',
      'export.revenue_schedule',
      'report_file.downloaded',
      'journal_book.printed',
      'company.books_start_set',
      'opening.snapshot_received',
      'opening.saved',
      'opening.posted',
      'opening.reversed',
      'export.opening',
    ]);
    for (const action of [...PLATFORM_AUDIT_ACTIONS, ...COMPANY_AUDIT_ACTIONS]) {
      expect(action).toMatch(/^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$/);
    }
    expect(new Set(COMPANY_AUDIT_ACTIONS).size).toBe(COMPANY_AUDIT_ACTIONS.length);
    expect(new Set(PLATFORM_AUDIT_ACTIONS).size).toBe(PLATFORM_AUDIT_ACTIONS.length);
  });

  it('filter the company log by known actions only', () => {
    expect(auditQuerySchema.safeParse({ action: 'company.archived' }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ action: 'user.signed_in' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '2026-10-26' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '2026-10-26T00:00:00+03:00' }).success).toBe(true);
  });

  it('convert to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'PlatformAuditAction',
        'CompanyAuditAction',
        'ActorKind',
        'AuditEntry',
        'AuditQuery',
        'AuditPage',
        'Cursor',
        'PageQuery',
        'SignInEvent',
        'SignInPage',
      ]),
    );
  });
});
