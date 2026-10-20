import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-6', className)}
      {...props}
    />
  );
}

/**
 * A row of tabs on a hairline; scrolls sideways on narrow screens instead of wrapping. The hairline
 * is an inset shadow, inside the box, so the active marker covers it without overflowing downwards
 * (a border would leave the marker 1 px outside and show a vertical scrollbar).
 */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  const list = useRef<HTMLDivElement>(null);
  // A tab opened from a link can sit past the visible part of the row: the row scrolls to show
  // it, sideways only, so the page itself does not move.
  useEffect(() => {
    const row = list.current;
    const active = row?.querySelector<HTMLElement>('[data-active]');
    if (!row || !active) return;
    const rowBox = row.getBoundingClientRect();
    const tabBox = active.getBoundingClientRect();
    if (tabBox.left < rowBox.left) row.scrollBy({ left: tabBox.left - rowBox.left });
    else if (tabBox.right > rowBox.right) row.scrollBy({ left: tabBox.right - rowBox.right });
  }, []);
  return (
    <TabsPrimitive.List
      ref={list}
      data-slot="tabs-list"
      className={cn(
        'flex w-full items-stretch gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * One tab. The active tab carries a 2 px marker on the hairline (§4 lines), in the primary color:
 * green in light, sand in dark.
 */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'relative flex h-control shrink-0 items-center gap-2 rounded-t-md px-3 text-control whitespace-nowrap text-muted-foreground select-none',
        'transition-colors duration-150 ease-out hover:text-foreground',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon",
        'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary after:opacity-0 after:transition-opacity after:duration-150',
        'data-active:font-medium data-active:text-foreground data-active:after:opacity-100',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex flex-col gap-6 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
