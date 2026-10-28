import { ar } from '@vertex-mizan/i18n';
import { Field, FieldDescription, FieldError, FieldLabel, PasswordInput } from '@vertex-mizan/ui';

const t = ar.auth.fields;

interface NewPasswordFieldsProps {
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  errors: { password?: string | undefined; confirm?: string | undefined };
}

/** A new password typed twice, with its rule (S01 rule 4): reset, invitation and the security page. */
/** The ids of the two fields, for a form's error summary. */
export const newPasswordFieldIds = { password: 'new-password', confirm: 'confirm-password' };

export function NewPasswordFields({
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  errors,
}: NewPasswordFieldsProps) {
  return (
    <>
      <Field id={newPasswordFieldIds.password} invalid={errors.password !== undefined}>
        <FieldLabel>{t.newPassword}</FieldLabel>
        <PasswordInput
          autoComplete="new-password"
          showLabel={t.showPassword}
          hideLabel={t.hidePassword}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <FieldDescription>{t.passwordRule}</FieldDescription>
        <FieldError match={errors.password !== undefined}>{errors.password}</FieldError>
      </Field>
      <Field id={newPasswordFieldIds.confirm} invalid={errors.confirm !== undefined}>
        <FieldLabel>{t.confirmPassword}</FieldLabel>
        <PasswordInput
          autoComplete="new-password"
          showLabel={t.showPassword}
          hideLabel={t.hidePassword}
          value={confirm}
          onChange={(event) => onConfirmChange(event.target.value)}
        />
        <FieldError match={errors.confirm !== undefined}>{errors.confirm}</FieldError>
      </Field>
    </>
  );
}
