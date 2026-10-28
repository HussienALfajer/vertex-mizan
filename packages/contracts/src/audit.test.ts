import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditQuerySchema, COMPANY_AUDIT_ACTIONS, PLATFORM_AUDIT_ACTIONS } from './audit.js';

describe('audit actions', () => {
  // Stored values: a later spec appends, never renames (S01, "Audit").
  it('are the platform and company actions of S01 to S03, as <entity>.<verb>', () => {
    expect(PLATFORM_AUDIT_ACTIONS).toHaveLength(11);
    expect(COMPANY_AUDIT_ACTIONS).toHaveLength(50);
    expect(COMPANY_AUDIT_ACTIONS.slice(15, 17)).toEqual(['account.created', 'account.updated']);
    expect(COMPANY_AUDIT_ACTIONS.slice(38, 41)).toEqual([
      'export.chart',
      'entry.posted',
      'draft.created',
    ]);
    expect(COMPANY_AUDIT_ACTIONS.slice(-1)).toEqual(['company.settings_updated']);
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
