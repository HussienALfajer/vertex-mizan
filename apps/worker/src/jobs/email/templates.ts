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
    case 'daily_anchor': {
      const { anchoredOn, anchors } = emailDataSchemas.daily_anchor.parse(data);
      const listed = anchors
        .map((anchor) =>
          fill(email.dailyAnchor.anchor, {
            companyName: anchor.companyName,
            anchoredOn,
            entryCount: String(anchor.entryCount),
            headHash: anchor.headHash,
          }),
        )
        .join('\n\n');
      return {
        to,
        subject: fill(email.dailyAnchor.subject, { anchoredOn }),
        text: signed(fill(email.dailyAnchor.body, { anchoredOn, anchors: listed })),
      };
    }
    case 'export_ready': {
      const ready = emailDataSchemas.export_ready.parse(data);
      return {
        to,
        subject: fill(email.exportReady.subject, { companyName: ready.companyName }),
        text: signed(
          fill(email.exportReady.body, {
            companyName: ready.companyName,
            link: ready.link,
            expiresAt: damascusTime(ready.expiresAt),
          }),
        ),
      };
    }
    case 'held_digest': {
      const digest = emailDataSchemas.held_digest.parse(data);
      const held =
        digest.held.length === 0
          ? ''
          : `\n\n${fill(email.heldDigest.heldSection, {
              newlyHeld: String(digest.newlyHeld),
              lines: digest.held
                .map(({ reason, count }) =>
                  fill(email.heldDigest.line, {
                    reason: email.heldDigest.reasons[reason],
                    count: String(count),
                  }),
                )
                .join('\n'),
              link: digest.link,
            })}`;
      // S10 "Jobs": the opening not posted since Hub's snapshot arrived, first.
      const opening = digest.openingLink
        ? `\n\n${fill(email.heldDigest.opening, { link: digest.openingLink })}`
        : '';
      // S07: the ended months not closed, after the held events, when there are any.
      const unclosed =
        digest.unclosedMonths.length === 0
          ? ''
          : `\n\n${email.heldDigest.unclosedTitle}\n${digest.unclosedMonths
              .map(({ period, failingItems }) =>
                fill(email.heldDigest.unclosedLine, { period, count: String(failingItems) }),
              )
              .join('\n')}`;
      // S08 rule 16: the reconciliation's days not clean, after the months, when there are any.
      const reconciliation =
        digest.reconciliation.length === 0
          ? ''
          : `\n\n${email.heldDigest.reconciliationTitle}\n${digest.reconciliation
              .map(
                ({ date, state, gaps, afterClose }) =>
                  (state === 'missing'
                    ? fill(email.heldDigest.reconciliationMissing, { date })
                    : fill(email.heldDigest.reconciliationDifferences, {
                        date,
                        count: String(gaps),
                      })) + (afterClose ? email.heldDigest.afterClose : ''),
              )
              .join('\n')}${
              digest.reconciliationLink
                ? `\n\n${fill(email.heldDigest.reconciliationLink, { link: digest.reconciliationLink })}`
                : ''
            }`;
      return {
        to,
        subject: fill(email.heldDigest.subject, { companyName: digest.companyName }),
        text: signed(
          fill(email.heldDigest.body, {
            companyName: digest.companyName,
            day: digest.day,
            opening,
            held,
            unclosed,
            reconciliation,
          }),
        ),
      };
    }
  }
}
