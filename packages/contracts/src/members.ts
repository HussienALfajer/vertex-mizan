import { z } from 'zod';
import { acceptsPeriodPermission, type MembershipAccess, roleSchema } from './access.js';
import { emailSchema, linkTokenSchema, passwordSchema, personNameSchema } from './people.js';

/** A role with the period permission, which only an accountant may carry (S01). */
const roleAssignmentShape = { role: roleSchema, canClosePeriods: z.boolean() };

const periodPermissionOnAccountantOnly = {
  message: 'The period permission is for an accountant only',
  path: ['canClosePeriods'],
};

function periodPermissionFits(assignment: MembershipAccess): boolean {
  return !assignment.canClosePeriods || acceptsPeriodPermission(assignment.role);
}

/** The id of a member or an invitation in a path. */
export const idParamSchema = z.object({ id: z.uuid() }).meta({ id: 'IdParam' });

export type IdParam = z.infer<typeof idParamSchema>;

/** A member of the active company (`GET /api/members`). */
export const memberSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    canClosePeriods: z.boolean(),
    twoFactorEnabled: z.boolean(),
    joinedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Member' });

export type Member = z.infer<typeof memberSchema>;

/** `PATCH /api/members/:id`. */
export const updateMemberSchema = z
  .object(roleAssignmentShape)
  .refine(periodPermissionFits, periodPermissionOnAccountantOnly)
  .meta({ id: 'UpdateMember' });

export type UpdateMember = z.infer<typeof updateMemberSchema>;

/** `POST /api/invitations`. */
export const createInvitationSchema = z
  .object({ email: emailSchema, ...roleAssignmentShape })
  .refine(periodPermissionFits, periodPermissionOnAccountantOnly)
  .meta({ id: 'CreateInvitation' });

export type CreateInvitation = z.infer<typeof createInvitationSchema>;

/** A pending invitation (`GET /api/invitations`). */
export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: roleSchema,
    canClosePeriods: z.boolean(),
    /** Null for the first owner's invitation, sent by the server command (S01 rule 9). */
    invitedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Invitation' });

export type Invitation = z.infer<typeof invitationSchema>;

/** The invitation token from the link's fragment (base64url). */
export const invitationTokenSchema = linkTokenSchema;

/**
 * `POST /api/invitations/lookup`: the token from the link's fragment, in the body so it never
 * reaches a server or proxy log as a query string (S01 "Invitation link leaked").
 */
export const lookupInvitationSchema = z
  .object({ token: invitationTokenSchema })
  .meta({ id: 'LookupInvitation' });

export type LookupInvitation = z.infer<typeof lookupInvitationSchema>;

/** `POST /api/invitations/lookup`: what the link invites to, before accepting. */
export const invitationLookupSchema = z
  .object({
    companyName: z.string(),
    role: roleSchema,
    email: z.string(),
    /** Whether the email has a person already: they sign in instead of setting a password. */
    personExists: z.boolean(),
  })
  .meta({ id: 'InvitationLookup' });

export type InvitationLookup = z.infer<typeof invitationLookupSchema>;

/** `POST /api/invitations/accept`: a new person also sets their name and password. */
export const acceptInvitationSchema = z
  .object({
    token: invitationTokenSchema,
    name: personNameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((accept) => (accept.name === undefined) === (accept.password === undefined), {
    message: 'A new person sets both a name and a password',
    path: ['password'],
  })
  .meta({ id: 'AcceptInvitation' });

export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;
