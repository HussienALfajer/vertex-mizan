import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROLES } from './access.js';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  invitationTokenSchema,
  updateMemberSchema,
} from './members.js';

const token = 'A'.repeat(43);

describe('role assignments', () => {
  it('carry the period permission on an accountant only', () => {
    for (const role of ROLES) {
      expect(updateMemberSchema.safeParse({ role, canClosePeriods: true }).success).toBe(
        role === 'accountant',
      );
      expect(updateMemberSchema.safeParse({ role, canClosePeriods: false }).success).toBe(true);
    }
    expect(
      createInvitationSchema.safeParse({
        email: 'a@example.test',
        role: 'viewer',
        canClosePeriods: true,
      }).success,
    ).toBe(false);
  });

  it('lower-case the invited email', () => {
    const invitation = createInvitationSchema.parse({
      email: ' New.Member@Example.TEST',
      role: 'accountant',
      canClosePeriods: true,
    });
    expect(invitation.email).toBe('new.member@example.test');
  });
});

describe('accepting an invitation', () => {
  it('takes a base64url token', () => {
    expect(invitationTokenSchema.safeParse(token).success).toBe(true);
    expect(invitationTokenSchema.safeParse('short').success).toBe(false);
    expect(invitationTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('needs both a name and a password for a new person, or neither for an existing one', () => {
    expect(acceptInvitationSchema.safeParse({ token }).success).toBe(true);
    expect(
      acceptInvitationSchema.safeParse({ token, name: 'شخص', password: 'a'.repeat(12) }).success,
    ).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token, name: 'شخص' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token, password: 'a'.repeat(12) }).success).toBe(
      false,
    );
  });

  it('converts to JSON Schema with the ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'Member',
        'UpdateMember',
        'CreateInvitation',
        'Invitation',
        'LinkToken',
        'LookupInvitation',
        'IdParam',
        'InvitationLookup',
        'AcceptInvitation',
      ]),
    );
  });
});
