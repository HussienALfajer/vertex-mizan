import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, emailDataSchemas } from './email.js';

describe('emailDataSchemas', () => {
  it('has a template input for every kind', () => {
    expect(Object.keys(emailDataSchemas)).toEqual([...EMAIL_KINDS]);
  });

  it('accepts an invitation from a person or from the server command', () => {
    const invitation = {
      companyName: 'شركة اختبار',
      role: 'accountant',
      inviterName: 'شخص تجريبي',
      link: 'https://mizan.example.test/invitation#token=synthetic',
      expiresAt: '2026-11-02T10:00:00.000Z',
    };
    expect(emailDataSchemas.invitation.parse(invitation)).toEqual(invitation);
    expect(emailDataSchemas.invitation.parse({ ...invitation, inviterName: null })).toMatchObject({
      inviterName: null,
    });
  });

  it('refuses a link that is not a web address and a role that does not exist', () => {
    expect(
      emailDataSchemas.password_reset.safeParse({
        link: 'javascript:alert(1)',
        expiresAt: '2026-11-02T10:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      emailDataSchemas.invitation.safeParse({
        companyName: 'شركة اختبار',
        role: 'admin',
        inviterName: null,
        link: 'https://mizan.example.test/invitation#token=synthetic',
        expiresAt: '2026-11-02T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('notifies a two-factor reset by an owner or by Vertex', () => {
    expect(emailDataSchemas.two_factor_reset.parse({ companyName: null })).toEqual({
      companyName: null,
    });
  });
});
