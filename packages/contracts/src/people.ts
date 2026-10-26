import { z } from 'zod';
import { permissionSchema, roleSchema } from './access.js';

/**
 * An email address as typed: trimmed and lower-cased for matching and storage (S01 edge case 10),
 * at most 254 characters.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .meta({ id: 'Email' });

/**
 * A new password: 12 to 128 characters, no composition rules (S01 rule 4). The server also refuses
 * one equal to the person's email, which it knows.
 */
export const passwordSchema = z.string().min(12).max(128).meta({ id: 'Password' });

/** A person's name: 1–120 characters after trimming. */
export const personNameSchema = z.string().trim().min(1).max(120).meta({ id: 'PersonName' });

/** A six-digit authenticator code (TOTP, RFC 6238). */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/)
  .meta({ id: 'TotpCode' });

/** A single-use backup code, as printed. */
export const backupCodeSchema = z.string().trim().min(1).max(32).meta({ id: 'BackupCode' });

/** The first step of sign-in. A password is checked as stored, whatever its length. */
export const signInSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .meta({ id: 'SignIn' });

export type SignIn = z.infer<typeof signInSchema>;

/** A fresh authenticator code for a sensitive action (`POST /api/auth/reauthenticate`). */
export const reauthenticateSchema = z
  .object({ code: z.union([totpCodeSchema, backupCodeSchema]) })
  .meta({ id: 'Reauthenticate' });

export type Reauthenticate = z.infer<typeof reauthenticateSchema>;

/** `POST /api/me/password`. */
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .meta({ id: 'ChangePassword' });

export type ChangePassword = z.infer<typeof changePasswordSchema>;

/** `POST /api/session/company`: the company to enter. */
export const enterCompanySchema = z.object({ companyId: z.uuid() }).meta({ id: 'EnterCompany' });

export type EnterCompany = z.infer<typeof enterCompanySchema>;

/** One of the person's active memberships, with its company. */
export const myMembershipSchema = z
  .object({
    membershipId: z.uuid(),
    company: z.object({
      id: z.uuid(),
      name: z.string(),
      nameLatin: z.string().nullable(),
      archived: z.boolean(),
    }),
    role: roleSchema,
    canClosePeriods: z.boolean(),
  })
  .meta({ id: 'MyMembership' });

export type MyMembership = z.infer<typeof myMembershipSchema>;

/** The first step's answer: whether the second step (an authenticator or backup code) follows. */
export const signInResultSchema = z
  .object({ twoFactorRequired: z.boolean() })
  .meta({ id: 'SignInResult' });

export type SignInResult = z.infer<typeof signInResultSchema>;

/** `POST /api/auth/two-factor/verify-totp`: the second step, or the first code of enrolment. */
export const verifyTotpSchema = z.object({ code: totpCodeSchema }).meta({ id: 'VerifyTotp' });

export type VerifyTotp = z.infer<typeof verifyTotpSchema>;

/** `POST /api/auth/two-factor/verify-backup-code`: the second step with a backup code. */
export const verifyBackupCodeSchema = z
  .object({ code: backupCodeSchema })
  .meta({ id: 'VerifyBackupCode' });

export type VerifyBackupCode = z.infer<typeof verifyBackupCodeSchema>;

/** `POST /api/auth/two-factor/enable`: the password again, before a new authenticator. */
export const enableTwoFactorSchema = z
  .object({ password: z.string().min(1).max(128) })
  .meta({ id: 'EnableTwoFactor' });

export type EnableTwoFactor = z.infer<typeof enableTwoFactorSchema>;

/**
 * A new authenticator to add (S01 rule 3): its `otpauth://` URI for the QR code (the secret is in
 * it, shown as text too) and its 10 backup codes, which the web shows once, after the first code
 * verifies. A person re-enrolling keeps their old authenticator and codes in force until then.
 */
export const twoFactorSetupSchema = z
  .object({
    totpURI: z.string().startsWith('otpauth://'),
    backupCodes: z.array(z.string()).length(10),
  })
  .meta({ id: 'TwoFactorSetup' });

export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

/** A one-time token from a link's fragment (base64url): an invitation or a password reset. */
export const linkTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32,128}$/)
  .meta({ id: 'LinkToken' });

/** `POST /api/auth/request-password-reset`: answered alike whether the email exists or not. */
export const requestPasswordResetSchema = z
  .object({ email: emailSchema })
  .meta({ id: 'RequestPasswordReset' });

export type RequestPasswordReset = z.infer<typeof requestPasswordResetSchema>;

/** `POST /api/auth/reset-password`: the link's token and the new password. */
export const resetPasswordSchema = z
  .object({ token: linkTokenSchema, password: passwordSchema })
  .meta({ id: 'ResetPassword' });

export type ResetPassword = z.infer<typeof resetPasswordSchema>;

/** A new set of single-use backup codes, shown once (S01 rule 3). */
export const backupCodesSchema = z
  .object({ backupCodes: z.array(z.string()).length(10) })
  .meta({ id: 'BackupCodes' });

export type BackupCodes = z.infer<typeof backupCodesSchema>;

/** `GET /api/me`: the signed-in person, their companies and what they may do in the active one. */
export const meSchema = z
  .object({
    person: z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      twoFactorEnabled: z.boolean(),
    }),
    memberships: z.array(myMembershipSchema),
    activeCompanyId: z.uuid().nullable(),
    /** The effective permissions in the active company; empty without one. */
    permissions: z.array(permissionSchema),
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof meSchema>;
