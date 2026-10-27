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
  it('gives each role the permissions of S01 and S02', () => {
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
      ],
      accountant: [
        'company.read',
        'accounts.read',
        'accounts.manage',
        'dimensions.read',
        'dimensions.manage',
        'rates.read',
        'rates.manage',
      ],
      approver: ['company.read', 'accounts.read', 'dimensions.read', 'rates.read'],
      viewer: ['company.read', 'accounts.read', 'dimensions.read', 'rates.read'],
      auditor: [
        'company.read',
        'members.read',
        'audit.read',
        'accounts.read',
        'dimensions.read',
        'rates.read',
      ],
    });
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
