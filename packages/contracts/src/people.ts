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
