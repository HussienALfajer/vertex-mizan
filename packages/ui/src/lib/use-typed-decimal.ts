import { groupTypedDecimal } from '@vertex-mizan/contracts';
import {
  type ClipboardEvent,
  type Ref,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
} from 'react';

/**
 * Thousands separators shown while a figure is typed (owner, 2026-11-20): `group(next, previous)`
 * turns the text an input just received into its grouped form through the money module's
 * `groupTypedDecimal()` (`previous` is the text the field held, so only its own grouping commas
 * move), and the caret is put back after the same digit once React has rendered it. Each call
 * renders the field again even when the grouped text equals the old one (a grouping comma
 * deleted), or React would restore that text with the caret at the end. Attach `onPaste` too, so
 * a paste is judged by what it pasted. Attach `ref` to the input (it forwards to the caller's own `ref`, if any). The text stays a
 * text: the caller parses it on commit as before.
 */
function useTypedDecimal({
  allowNegative = true,
  ref: outer,
}: {
  allowNegative?: boolean;
  ref?: Ref<HTMLInputElement> | undefined;
} = {}) {
  const input = useRef<HTMLInputElement | null>(null);
  const pending = useRef<number | null>(null);
  const [, rendered] = useReducer((count: number) => count + 1, 0);
  // What the coming change pastes: a paste over a selection can look like a deletion, so its
  // commas are judged by the clipboard's text, not by comparing the two texts.
  const pasted = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const caret = pending.current;
    pending.current = null;
    const element = input.current;
    if (caret === null || element === null || element.ownerDocument.activeElement !== element) {
      return;
    }
    element.setSelectionRange(caret, caret);
  });

  const ref: RefCallback<HTMLInputElement> = useCallback(
    (element) => {
      input.current = element;
      if (typeof outer === 'function') outer(element);
      else if (outer) outer.current = element;
    },
    [outer],
  );

  const group = (next: string, previous: string): string => {
    const caret = input.current?.selectionStart ?? next.length;
    const result = groupTypedDecimal(
      { text: next, caret },
      { allowNegative, previous, pasted: pasted.current },
    );
    pasted.current = undefined;
    pending.current = result.caret;
    rendered();
    return result.text;
  };

  /** Attach to the input's `onPaste` (the field's own handler runs too). */
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    pasted.current = event.clipboardData.getData('text');
  };

  return { ref, group, onPaste };
}

export { useTypedDecimal };
