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
  Field,
  FieldLabel,
  Input,
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
  // A backup code confirms too (S01 rule 7): a person who lost the authenticator re-enrols with it.
  const [mode, setMode] = useState<'app' | 'backup'>('app');
  const [code, setCode] = useState('');
  const submitted = useRef(false);
  const confirm = useMutation({
    mutationFn: (value: string) => api('POST', '/auth/reauthenticate', { body: { code: value } }),
    onSuccess: () => {
      clear();
      onConfirmed();
    },
    onSettled: () => {
      submitted.current = false;
    },
  });
  const ready = mode === 'app' ? code.length === 6 : code.trim() !== '';

  function clear() {
    setCode('');
    setMode('app');
    confirm.reset();
  }

  function submit(value: string) {
    const complete = mode === 'app' ? value.length === 6 : value.trim() !== '';
    if (!complete || submitted.current) return;
    submitted.current = true;
    confirm.mutate(value.trim());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        clear();
        onCancel();
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            // React events cross portals: the page's form around the dialog must not submit too.
            event.stopPropagation();
            submit(code);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.reauth.title}</DialogTitle>
            <DialogDescription>
              {mode === 'app' ? t.reauth.description : t.twoFactor.backupDescription}
            </DialogDescription>
          </DialogHeader>
          {mode === 'app' ? (
            <OtpField
              aria-label={t.fields.code}
              slotLabel={(position) => `${t.fields.slot} ${position}`}
              value={code}
              onValueChange={setCode}
              onValueComplete={submit}
              autoFocus
              disabled={confirm.isPending}
            />
          ) : (
            <Field>
              <FieldLabel>{t.fields.backupCode}</FieldLabel>
              <Input
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
              />
            </Field>
          )}
          <FormError error={confirm.error} />
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={() => {
              setMode(mode === 'app' ? 'backup' : 'app');
              setCode('');
              confirm.reset();
            }}
          >
            {mode === 'app' ? t.twoFactor.useBackup : t.twoFactor.useApp}
          </Button>
          <DialogFooter>
            <Button type="submit" loading={confirm.isPending} disabled={!ready}>
              {t.reauth.submit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                clear();
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
