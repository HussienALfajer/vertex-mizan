import { useMutation } from '@tanstack/react-query';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  OtpField,
} from '@vertex-mizan/ui';
import { type ReactNode, useRef, useState } from 'react';
import { api, hasCode } from '../lib/api';
import { FormError } from './form-error';

const t = ar.auth;

/** The person closed the re-authentication dialog: the action did not run, and nothing failed. */
class ReauthCancelled extends Error {
  override readonly name = 'ReauthCancelled';
}

export function isCancelled(error: unknown): boolean {
  return error instanceof ReauthCancelled;
}

interface Waiting {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Runs sensitive actions (S01: a fresh code before each one). When the API answers
 * `REAUTHENTICATION_REQUIRED`, the dialog asks for an authenticator code, then the action runs
 * once more; closing the dialog rejects with an error `FormError` does not show. Render `dialog`.
 */
export function useSensitiveAction(): {
  run: <T>(action: () => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!hasCode(error, 'REAUTHENTICATION_REQUIRED')) throw error;
      await new Promise<void>((resolve, reject) => setWaiting({ resolve, reject }));
      return action();
    }
  }

  const dialog = (
    <ReauthDialog
      open={waiting !== null}
      onConfirmed={() => {
        waiting?.resolve();
        setWaiting(null);
      }}
      onCancel={() => {
        waiting?.reject(new ReauthCancelled());
        setWaiting(null);
      }}
    />
  );
  return { run, dialog };
}

function ReauthDialog({
  open,
  onConfirmed,
  onCancel,
}: {
  open: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const submitted = useRef(false);
  const confirm = useMutation({
    mutationFn: (value: string) => api('POST', '/auth/reauthenticate', { body: { code: value } }),
    onSuccess: () => {
      setCode('');
      onConfirmed();
    },
    onSettled: () => {
      submitted.current = false;
    },
  });

  function submit(value: string) {
    if (value.length !== 6 || submitted.current) return;
    submitted.current = true;
    confirm.mutate(value);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setCode('');
        confirm.reset();
        onCancel();
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(code);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.reauth.title}</DialogTitle>
            <DialogDescription>{t.reauth.description}</DialogDescription>
          </DialogHeader>
          <OtpField
            aria-label={t.fields.code}
            slotLabel={(position) => `${t.fields.slot} ${position}`}
            value={code}
            onValueChange={setCode}
            onValueComplete={submit}
            autoFocus
            disabled={confirm.isPending}
          />
          <FormError error={confirm.error} />
          <DialogFooter>
            <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>
              {t.reauth.submit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCode('');
                confirm.reset();
                onCancel();
              }}
            >
              {t.reauth.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
