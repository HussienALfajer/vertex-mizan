import { z } from 'zod';
import { roleSchema } from './access.js';

/**
 * The emails Mizan sends (S01): written to the outbox in the transaction of the change that sends
 * them, then sent by the worker's `email.send` job (owner decision 2026-10-26). A kind is never
 * renamed: queued rows carry it.
 */
export const EMAIL_KINDS = [
  'invitation',
  'password_reset',
  'two_factor_reset',
  // S03: the daily anchor and the full export.
  'daily_anchor',
  'export_ready',
] as const;

export const emailKindSchema = z.enum(EMAIL_KINDS);

export type EmailKind = z.infer<typeof emailKindSchema>;

/** A link to the web app; its token travels in the fragment, never in a server log (S01). */
const linkSchema = z.url({ protocol: /^https?$/ });

/** What each email's template reads. `link` carries a one-time token until the email is sent. */
export const emailDataSchemas = {
  /** An invitation to a company (S01 rule 15), valid 7 days. */
  invitation: z.object({
    companyName: z.string().min(1),
    role: roleSchema,
    /** Null for the first owner's invitation, sent by the server command. */
    inviterName: z.string().min(1).nullable(),
    link: linkSchema,
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  /** A password reset link (S01 rule 6), valid 1 hour. */
  password_reset: z.object({
    link: linkSchema,
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  /**
   * The notice that a person's two-factor was reset (S01 rule 21): by an owner of a company, or by
   * Vertex with the server command (`companyName` null).
   */
  two_factor_reset: z.object({ companyName: z.string().min(1).nullable() }),
  /**
   * The daily anchor (S03 rule 20): to each owner, the head of every company they own as at the
   * end of `anchoredOn` (Damascus), to paste into the integrity check later.
   */
  daily_anchor: z.object({
    anchoredOn: z.iso.date(),
    anchors: z
      .array(
        z.object({
          companyName: z.string().min(1),
          entryCount: z.int().min(1),
          headHash: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .min(1),
  }),
  /** A company's full export is ready (S03 rule 21): the link to the export page, for 24 hours. */
  export_ready: z.object({
    companyName: z.string().min(1),
    link: linkSchema,
    expiresAt: z.iso.datetime({ offset: true }),
  }),
} as const satisfies Record<EmailKind, z.ZodType>;

export type EmailData<Kind extends EmailKind> = z.infer<(typeof emailDataSchemas)[Kind]>;
