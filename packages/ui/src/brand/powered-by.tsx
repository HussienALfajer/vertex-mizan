import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { VertexMizanMark } from './logo';

type PoweredByProps = Omit<ComponentProps<'p'>, 'children'> & {
  /** "Powered by Vertex Mizan", translated by the app (`common.poweredBy`). */
  label: string;
};

/**
 * "Powered by Vertex Mizan" with the mark (ADR 0009): in the app shell's footer, and in the footer
 * of printed books and statements, whose header belongs to the company. The mark is decorative:
 * the label names the product.
 */
function PoweredBy({ label, className, ...props }: PoweredByProps) {
  return (
    <p
      data-slot="powered-by"
      className={cn('inline-flex items-center gap-2 text-control text-muted-foreground', className)}
      {...props}
    >
      <VertexMizanMark className="w-6 text-primary" />
      <span>{label}</span>
    </p>
  );
}

export { PoweredBy, type PoweredByProps };
