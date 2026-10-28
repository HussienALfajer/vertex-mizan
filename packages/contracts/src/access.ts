import { z } from 'zod';

/**
 * The roles of a membership: one per person and company (S01, phase 1 scope §3). Values are stored
 * in the `membership_role` enum and never renamed.
 */
export const ROLES = ['owner', 'accountant', 'approver', 'viewer', 'auditor'] as const;

export const roleSchema = z.enum(ROLES).meta({ id: 'Role' });

export type Role = z.infer<typeof roleSchema>;

/**
 * Every permission a company route can require. Each spec adds its keys here in its own PR, with
 * the roles that hold them per the role intents of S01.
 */
export const PERMISSIONS = [
  'company.read',
  'company.settings',
  'company.archive',
  'members.read',
  'members.manage',
  'audit.read',
  'periods.close',
  // S02: the chart of accounts, dimensions and rates.
  'accounts.read',
  'accounts.manage',
  'dimensions.read',
  'dimensions.manage',
  'rates.read',
  'rates.manage',
  // S03: journal entries and their drafts.
  'entries.read',
  'drafts.read',
  'drafts.manage',
  'entries.post',
  'entries.approve',
  'entries.attach',
  // S03: trust and the full export.
  'integrity.read',
  'company.export',
] as const;

export const permissionSchema = z.enum(PERMISSIONS).meta({ id: 'Permission' });

export type Permission = z.infer<typeof permissionSchema>;

/**
 * What each role holds. `periods.close` reaches an accountant only through the period permission
 * of their membership (`effectivePermissions`), never through the role itself.
 */
export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
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
  ],
  approver: [
    'company.read',
    'accounts.read',
    'dimensions.read',
    'rates.read',
    'entries.read',
    'drafts.read',
    'entries.approve',
  ],
  viewer: ['company.read', 'accounts.read', 'dimensions.read', 'rates.read', 'entries.read'],
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
  ],
};

/** The parts of a membership that decide its permissions. */
export interface MembershipAccess {
  role: Role;
  canClosePeriods: boolean;
}

/**
 * The permissions of a membership: its role's, plus `periods.close` for an accountant with the
 * period permission. The API guard and the web app read only this; the web uses it to hide what
 * the person cannot do, the API to refuse it.
 */
export function effectivePermissions(membership: MembershipAccess): readonly Permission[] {
  const granted = rolePermissions[membership.role];
  if (membership.role === 'accountant' && membership.canClosePeriods) {
    return PERMISSIONS.filter((key) => key === 'periods.close' || granted.includes(key));
  }
  return granted;
}

/** Whether a role may carry the period permission: an accountant only (S01; the owner has it). */
export function acceptsPeriodPermission(role: Role): boolean {
  return role === 'accountant';
}
