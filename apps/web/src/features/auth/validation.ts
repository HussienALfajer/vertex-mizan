import { emailSchema, passwordSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';

const t = ar.auth.validation;

/** Checked in the browser before sending; the API checks again with the same schemas. */
export function emailError(value: string): string | undefined {
  if (value.trim() === '') return t.required;
  return emailSchema.safeParse(value).success ? undefined : t.email;
}

/** A new password (S01 rule 4): 12–128 characters, not the email, typed twice alike. */
export function newPasswordError(
  password: string,
  confirm: string,
  email?: string,
): { password?: string; confirm?: string } {
  if (!passwordSchema.safeParse(password).success) return { password: t.passwordLength };
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return { password: t.passwordIsEmail };
  }
  if (password !== confirm) return { confirm: t.passwordMismatch };
  return {};
}
