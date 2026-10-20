import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the Vertex scales that differ from Tailwind's defaults, so `text-md` and
// the density's `text-control` are read as font sizes (not colors, which would drop the color
// beside them), the density sizes (`h-control`, `px-cell`…) as spacing, and `shadow-float` as a
// shadow.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'control'],
      spacing: ['control', 'row', 'cell', 'icon', 'hit'],
      shadow: ['float'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
