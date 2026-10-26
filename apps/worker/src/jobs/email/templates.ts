import { type EmailKind, emailDataSchemas } from '@vertex-mizan/contracts';
import { ar, displayTimeZone, formatLocale } from '@vertex-mizan/i18n';
import type { OutgoingEmail } from '../../core/email/email.module.js';

/** Fills the `{name}` placeholders of an i18n text; a missing value fails loudly. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for {${name}}`);
    return value;
  });
}

/** A time in Damascus, with Latin digits (S01 "Arabic strings and number formats"). */
function damascusTime(iso: string): string {
  return new Intl.DateTimeFormat(formatLocale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: displayTimeZone,
  }).format(new Date(iso));
}

/**
 * The subject and text of an outbox email, from its kind and data (`emailDataSchemas`). Data that
 * does not match its kind throws: the row stays in the outbox with the error's code.
 */
export function renderEmail(kind: EmailKind, data: unknown, to: string): OutgoingEmail {
  const { email } = ar;
  const signed = (text: string) => `${text}\n\n${email.signature}`;
  switch (kind) {
    case 'invitation': {
      const invitation = emailDataSchemas.invitation.parse(data);
      const inviter = invitation.inviterName
        ? fill(email.invitation.inviter, { inviterName: invitation.inviterName })
        : '';
      const values = {
        companyName: invitation.companyName,
        role: ar.roles[invitation.role],
        inviter,
        link: invitation.link,
        expiresAt: damascusTime(invitation.expiresAt),
      };
      return {
        to,
        subject: fill(email.invitation.subject, values),
        text: signed(fill(email.invitation.body, values)),
      };
    }
    case 'password_reset': {
      const reset = emailDataSchemas.password_reset.parse(data);
      return {
        to,
        subject: email.passwordReset.subject,
        text: signed(
          fill(email.passwordReset.body, {
            link: reset.link,
            expiresAt: damascusTime(reset.expiresAt),
          }),
        ),
      };
    }
    case 'two_factor_reset': {
      const notice = emailDataSchemas.two_factor_reset.parse(data);
      const body = notice.companyName
        ? fill(email.twoFactorReset.byOwner, { companyName: notice.companyName })
        : email.twoFactorReset.byVertex;
      return { to, subject: email.twoFactorReset.subject, text: signed(body) };
    }
  }
}
