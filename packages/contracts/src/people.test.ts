import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  backupCodeSchema,
  changePasswordSchema,
  emailSchema,
  meSchema,
  passwordSchema,
  reauthenticateSchema,
  signInSchema,
  totpCodeSchema,
} from './people.js';

describe('people schemas', () => {
  it('trim and lower-case an email for matching', () => {
    expect(emailSchema.parse('  Person.One@Example.TEST ')).toBe('person.one@example.test');
    expect(emailSchema.safeParse('not an email').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@example.test`).success).toBe(false);
  });

  it('take passwords of 12 to 128 characters, without composition rules', () => {
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
  });

  it('check a stored password at sign-in whatever its length', () => {
    expect(signInSchema.safeParse({ email: 'a@example.test', password: 'x' }).success).toBe(true);
    expect(signInSchema.safeParse({ email: 'a@example.test', password: '' }).success).toBe(false);
  });

  it('take a six-digit authenticator code or a backup code', () => {
    expect(totpCodeSchema.parse(' 123456 ')).toBe('123456');
    for (const code of ['12345', '1234567', '12a456']) {
      expect(totpCodeSchema.safeParse(code).success).toBe(false);
    }
    expect(backupCodeSchema.safeParse('abcde-12345').success).toBe(true);
    expect(reauthenticateSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(reauthenticateSchema.safeParse({ code: '' }).success).toBe(false);
  });

  it('describe the signed-in person with permissions from the map only', () => {
    const me = {
      person: {
        id: '019a2b3c-0000-7000-8000-000000000001',
        name: 'شخص تجريبي',
        email: 'person@example.test',
        twoFactorEnabled: true,
      },
      memberships: [],
      activeCompanyId: null,
      permissions: [],
    };
    expect(meSchema.safeParse(me).success).toBe(true);
    expect(meSchema.safeParse({ ...me, permissions: ['everything'] }).success).toBe(false);
  });

  it('convert to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'Email',
        'Password',
        'PersonName',
        'TotpCode',
        'BackupCode',
        'SignIn',
        'Reauthenticate',
        'ChangePassword',
        'EnterCompany',
        'MyMembership',
        'Me',
        'Role',
        'Permission',
      ]),
    );
  });
});
