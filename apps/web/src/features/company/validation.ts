import { policyNoteSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';

const t = ar.company.validation;

/** A company's name, Arabic or Latin: 1–200 characters after trimming (the contract's rule). */
export function nameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return t.required;
  return trimmed.length > 200 ? t.nameLength : undefined;
}

/** The policy note: 1–4,000 characters (`policyNoteSchema`). */
export function policyNoteError(value: string): string | undefined {
  if (value.trim() === '') return t.required;
  return policyNoteSchema.safeParse(value).success ? undefined : t.policyNoteLength;
}
