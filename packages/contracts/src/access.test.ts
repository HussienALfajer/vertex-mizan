import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  acceptsPeriodPermission,
  effectivePermissions,
  PERMISSIONS,
  ROLES,
  rolePermissions,
  roleSchema,
} from './access.js';

describe('the permission map', () => {
  it('gives each role the permissions of S01, S02 and S03', () => {
    expect(rolePermissions).toEqual({
      owner: [
        'company.read',
        'company.settings',
        'company.archive',
        'members.read',
        'members.manage',
        'audit.read',
        'periods.close',
        'accounts.read',
        'accounts.manage',
        'dimensions.read',
        'dimensions.manage',
        'rates.read',
        'rates.manage',
        'entries.read',
        'drafts.read',
        'drafts.manage',
        'entries.post',
        'entries.approve',
        'entries.attach',
        'integrity.read',
        'company.export',
        'open_items.read',
        'open_items.manage',
        'events.read',
        'events.manage',
        'events.dismiss',
        'posting_rules.read',
        'posting_rules.manage',
        'api_clients.read',
        'api_clients.manage',
        'recognition.read',
        'periods.read',
        'revaluation.post',
        'reconciliation.read',
        'reports.read',
      ],
      accountant: [
        'company.read',
        'accounts.read',
        'accounts.manage',
        'dimensions.read',
        'dimensions.manage',
        'rates.read',
        'rates.manage',
        'entries.read',
        'drafts.read',
        'drafts.manage',
        'entries.post',
        'entries.attach',
        'open_items.read',
        'open_items.manage',
        'events.read',
        'events.manage',
        'posting_rules.read',
        'posting_rules.manage',
        'recognition.read',
        'periods.read',
        'revaluation.post',
        'reconciliation.read',
        'reports.read',
      ],
      approver: [
        'company.read',
        'accounts.read',
        'dimensions.read',
        'rates.read',
        'entries.read',
        'drafts.read',
        'entries.approve',
        'open_items.read',
        'reports.read',
      ],
      viewer: [
        'company.read',
        'accounts.read',
        'dimensions.read',
        'rates.read',
        'entries.read',
        'open_items.read',
        'reports.read',
      ],
      auditor: [
        'company.read',
        'members.read',
        'audit.read',
        'accounts.read',
        'dimensions.read',
        'rates.read',
        'entries.read',
        'drafts.read',
        'integrity.read',
        'open_items.read',
        'events.read',
        'posting_rules.read',
        'api_clients.read',
        'recognition.read',
        'periods.read',
        'reconciliation.read',
        'reports.read',
      ],
    });
  });

  it('lets the S03 roles of the spec prepare, post, approve and attach (S03 "Access")', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('entries.read')).toEqual([...ROLES]);
    expect(holders('drafts.read')).toEqual(['owner', 'accountant', 'approver', 'auditor']);
    expect(holders('drafts.manage')).toEqual(['owner', 'accountant']);
    expect(holders('entries.post')).toEqual(['owner', 'accountant']);
    expect(holders('entries.attach')).toEqual(['owner', 'accountant']);
    expect(holders('entries.approve')).toEqual(['owner', 'approver']);
    expect(holders('integrity.read')).toEqual(['owner', 'auditor']);
    expect(holders('company.export')).toEqual(['owner']);
  });

  it('lets every role read open items and the owner and accountants manage due dates (S04 "Access")', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('open_items.read')).toEqual([...ROLES]);
    expect(holders('open_items.manage')).toEqual(['owner', 'accountant']);
  });

  it('gives the inbox, the mapping and the API clients to the roles of S05 "Access"', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('events.read')).toEqual(['owner', 'accountant', 'auditor']);
    expect(holders('events.manage')).toEqual(['owner', 'accountant']);
    expect(holders('events.dismiss')).toEqual(['owner']);
    expect(holders('posting_rules.read')).toEqual(['owner', 'accountant', 'auditor']);
    expect(holders('posting_rules.manage')).toEqual(['owner', 'accountant']);
    expect(holders('api_clients.read')).toEqual(['owner', 'auditor']);
    expect(holders('api_clients.manage')).toEqual(['owner']);
  });

  it('gives the recognition schedules to the roles of S06 "Access"', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('recognition.read')).toEqual(['owner', 'accountant', 'auditor']);
  });

  it('gives the periods and the revaluation to the roles of S07 "Access"', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('periods.read')).toEqual(['owner', 'accountant', 'auditor']);
    expect(holders('revaluation.post')).toEqual(['owner', 'accountant']);
  });

  it('gives the reconciliation to the roles of S08 "Access"', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('reconciliation.read')).toEqual(['owner', 'accountant', 'auditor']);
  });

  it('lets every role read the reports (S09 "Access")', () => {
    const holders = (key: (typeof PERMISSIONS)[number]) =>
      ROLES.filter((role) => rolePermissions[role].includes(key));
    expect(holders('reports.read')).toEqual([...ROLES]);
  });

  it('lets every role read the company profile, the chart, dimensions and rates', () => {
    for (const role of ROLES) {
      for (const key of [
        'company.read',
        'accounts.read',
        'dimensions.read',
        'rates.read',
      ] as const) {
        expect(rolePermissions[role]).toContain(key);
      }
    }
  });

  it('lets only the owner and the accountant keep the chart, dimensions and rates (S02)', () => {
    for (const key of ['accounts.manage', 'dimensions.manage', 'rates.manage'] as const) {
      expect(ROLES.filter((role) => rolePermissions[role].includes(key))).toEqual([
        'owner',
        'accountant',
      ]);
    }
  });

  it('keeps the role values stored in the database', () => {
    expect(ROLES).toEqual(['owner', 'accountant', 'approver', 'viewer', 'auditor']);
    expect(roleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('adds periods.close for an accountant with the period permission', () => {
    const accountant = rolePermissions.accountant;
    expect(effectivePermissions({ role: 'accountant', canClosePeriods: true })).toEqual([
      'company.read',
      'periods.close',
      ...accountant.filter((key) => key !== 'company.read'),
    ]);
    expect(effectivePermissions({ role: 'accountant', canClosePeriods: false })).toEqual(
      accountant,
    );
  });

  it('gives the owner periods.close without the switch', () => {
    expect(effectivePermissions({ role: 'owner', canClosePeriods: false })).toContain(
      'periods.close',
    );
  });

  it('accepts the period permission on an accountant only', () => {
    expect(ROLES.filter(acceptsPeriodPermission)).toEqual(['accountant']);
  });

  it('never grants a permission outside the role row, and periods.close only to owners and switched accountants', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), fc.boolean(), (role, canClosePeriods) => {
        const granted = effectivePermissions({ role, canClosePeriods });
        const extra = granted.filter((key) => !rolePermissions[role].includes(key));
        expect(extra).toEqual(role === 'accountant' && canClosePeriods ? ['periods.close'] : []);
        expect(granted.includes('periods.close')).toBe(
          role === 'owner' || (role === 'accountant' && canClosePeriods),
        );
        expect(new Set(granted).size).toBe(granted.length);
        for (const key of granted) expect(PERMISSIONS).toContain(key);
      }),
    );
  });
});
