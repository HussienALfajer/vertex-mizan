import type { InvitationLookup, Me, SignInPage, TwoFactorSetup } from '@vertex-mizan/contracts';
import { signedIn } from './test';

/** Synthetic answers of the access API (S01) shared by the screen and flow specs. */

/** A link token as the API mints it (base64url, 43 characters). */
export const linkToken = 'Zk3pQ9vX2mB7tR4wY8nC1sD6fH0jL5aE-_uKoGiTqWe';

export const notEnrolled: Me = {
  ...signedIn,
  person: { ...signedIn.person, twoFactorEnabled: false },
  memberships: [],
  activeCompanyId: null,
  permissions: [],
};

export const setup: TwoFactorSetup = {
  totpURI:
    'otpauth://totp/Vertex%20Mizan:owner%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Vertex%20Mizan',
  backupCodes: [
    'k7q2-m9xw',
    'p3vd-h8tn',
    'r5cz-w2jf',
    'b6ny-t4gs',
    'e8lu-x1ka',
    'f2mo-q7vb',
    'g9wr-c3hd',
    'j4ps-n6ze',
    'u1tk-y5ml',
    'z3ha-d8rq',
  ],
};

export const newPersonInvitation: InvitationLookup = {
  companyName: 'شركة اختبار',
  role: 'accountant',
  email: 'new.person@example.test',
  personExists: false,
};

export const signIns: SignInPage = {
  entries: [
    {
      id: '01900000-0000-7000-8000-000000000101',
      createdAt: '2026-10-27T07:15:00.000Z',
      action: 'user.signed_in',
      ipAddress: '203.0.113.24',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
    },
    {
      id: '01900000-0000-7000-8000-000000000102',
      createdAt: '2026-10-27T07:14:00.000Z',
      action: 'user.sign_in_failed',
      ipAddress: '203.0.113.24',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
    },
    {
      id: '01900000-0000-7000-8000-000000000103',
      createdAt: '2026-10-26T18:02:00.000Z',
      action: 'user.backup_code_used',
      ipAddress: null,
      userAgent: null,
    },
  ],
  nextCursor: null,
};
