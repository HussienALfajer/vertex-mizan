import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '../lib/cn';
import { DialogOverlay } from './dialog';

/**
 * A panel sliding in from the inline-start edge (the right in RTL), e.g. the navigation on phones
 * (Vertex Hub's sheet). A modal dialog: focus stays inside, Escape and the overlay close it.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-bold', className)}
      {...props}
    />
  );
}

function SheetContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface text-surface-foreground shadow-float outline-none',
          'transition-transform duration-250 ease-out',
          'ltr:data-starting-style:-translate-x-full ltr:data-ending-style:-translate-x-full',
          'rtl:data-starting-style:translate-x-full rtl:data-ending-style:translate-x-full',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };
