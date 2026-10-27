import { useMutation } from '@tanstack/react-query';
import { ar } from '@vertex-mizan/i18n';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@vertex-mizan/ui';
import { FormError } from './form-error';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  /** Archiving, removing: the confirm button in the danger color. */
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  /** After the action succeeded; the dialog closes itself. */
  onDone?: () => void | Promise<void>;
}

/**
 * An action confirmed without a reason (S02: archiving or restoring a dimension value or type,
 * removing a holiday). A refusal stays in the dialog with its Arabic text.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive = false,
  onConfirm,
  onDone,
}: ConfirmDialogProps) {
  const confirm = useMutation({
    mutationFn: onConfirm,
    onSuccess: async () => {
      close();
      await onDone?.();
    },
  });

  function close() {
    confirm.reset();
    onOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <FormError error={confirm.error} />
        <AlertDialogFooter>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {submitLabel}
          </Button>
          <Button variant="ghost" onClick={close}>
            {ar.common.cancel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
