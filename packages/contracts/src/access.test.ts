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
  it('gives each role the permissions of S01', () => {
    expect(rolePermissions).toEqual({
      owner: [
        'company.read',
        'company.settings',
        'company.archive',
        'members.read',
        'members.manage',
        'audit.read',
        'periods.close',
      ],
      accountant: ['company.read'],
      approver: ['company.read'],
      viewer: ['company.read'],
      auditor: ['company.read', 'members.read', 'audit.read'],
    });
  });

  it('lets every role read the company profile', () => {
    for (const role of ROLES) expect(rolePermissions[role]).toContain('company.read');
  });

  it('keeps the role values stored in the database', () => {
    expect(ROLES).toEqual(['owner', 'accountant', 'approver', 'viewer', 'auditor']);
    expect(roleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('adds periods.close for an accountant with the period permission', () => {
    expect(effectivePermissions({ role: 'accountant', canClosePeriods: true })).toEqual([
      'company.read',
      'periods.close',
    ]);
    expect(effectivePermissions({ role: 'accountant', canClosePeriods: false })).toEqual([
      'company.read',
    ]);
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
