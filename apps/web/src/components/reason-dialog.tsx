import { useMutation } from '@tanstack/react-query';
import { reasonSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Textarea,
} from '@vertex-mizan/ui';
import { type ReactNode, useState } from 'react';
import { FormError, FormErrorSummary } from './form-error';
import { useSensitiveAction } from './reauth-dialog';

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  reasonLabel: string;
  submitLabel: string;
  /** Removing, archiving, resetting: the confirm button in the danger color. */
  destructive?: boolean;
  /** The action with the typed reason, run as a sensitive action (a fresh code when asked). */
  onConfirm: (reason: string) => Promise<unknown>;
  /** After the action succeeded; the dialog closes itself. */
  onDone?: () => void | Promise<void>;
  children?: ReactNode;
}

/**
 * An action that needs a written reason (S01: archive, restore, remove a member, reset their
 * two-factor, leave). The reason is checked with the contract's schema before it is sent.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  submitLabel,
  destructive = false,
  onConfirm,
  onDone,
  children,
}: ReasonDialogProps) {
  const { run, dialog } = useSensitiveAction();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const confirm = useMutation({
    mutationFn: (value: string) => run(() => onConfirm(value)),
    onSuccess: async () => {
      close();
      await onDone?.();
    },
  });

  function close() {
    setReason('');
    setInvalid(undefined);
    setAttempt(0);
    confirm.reset();
    onOpenChange(false);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else close();
        }}
      >
        <DialogContent closeLabel={ar.common.close}>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const parsed = reasonSchema.safeParse({ reason });
              if (!parsed.success) {
                setInvalid(
                  reason.trim() === ''
                    ? ar.company.validation.required
                    : ar.company.validation.reasonLength,
                );
                setAttempt((count) => count + 1);
                return;
              }
              setInvalid(undefined);
              confirm.mutate(parsed.data.reason);
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <FormErrorSummary attempt={attempt} errors={[['reason', invalid]]} />
            {children}
            <Field id="reason" invalid={invalid !== undefined}>
              <FieldLabel>{reasonLabel}</FieldLabel>
              <Textarea
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldError match={invalid !== undefined}>{invalid}</FieldError>
            </Field>
            <FormError error={confirm.error} />
            <DialogFooter>
              <Button
                type="submit"
                variant={destructive ? 'destructive' : 'primary'}
                loading={confirm.isPending}
              >
                {submitLabel}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {ar.common.cancel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
