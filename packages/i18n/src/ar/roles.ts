import type { Role } from '@vertex-mizan/contracts';

/** The name of each role of a membership (S01 "Roles"; `docs/glossary.md`). */
export const roles = {
  owner: 'المالك',
  accountant: 'المحاسب',
  approver: 'المعتمِد',
  viewer: 'القارئ',
  auditor: 'المدقق',
} as const satisfies Record<Role, string>;
