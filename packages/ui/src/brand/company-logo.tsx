import { type ComponentProps, useState } from 'react';
import { cn } from '../lib/cn';
import { VertexMizanMark } from './logo';

type CompanyLogoProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The logo's address, or `undefined` when the company has none. */
  src?: string | undefined;
  /**
   * Accessible name: the company's name. Omit only when the name is written next to the logo,
   * which then is decorative.
   */
  label?: string;
  /** `sm` in the shell's bars, `md` in a settings preview, `lg` above the sign-in card. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Classes for the uploaded image only, not the mark: a light tile behind it where the surface
   * is dark (the sidebar), since a company's logo keeps its own colors.
   */
  imageClassName?: string;
};

const sizes = {
  sm: 'h-8 max-w-24',
  md: 'h-16 max-w-48',
  lg: 'h-20 max-w-64',
};

const markSizes = { sm: 'w-7', md: 'w-12', lg: 'w-16' };

/**
 * A company's own logo (S13, ADR 0024 §7): the image the company uploaded, kept whole in its box
 * (never cropped or stretched), or the Vertex Mizan mark when it has none or the image fails to
 * load. The image comes from the company, so it is shown as given, never recolored.
 */
function CompanyLogo({
  src,
  label,
  size = 'sm',
  imageClassName,
  className,
  ...props
}: CompanyLogoProps) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const showImage = src !== undefined && failed !== src;
  return (
    <span
      data-slot="company-logo"
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={label ?? ''}
          className={cn('w-auto object-contain', sizes[size], imageClassName)}
          onError={() => setFailed(src)}
        />
      ) : (
        <VertexMizanMark
          {...(label ? { label } : {})}
          className={cn('text-current', markSizes[size])}
        />
      )}
    </span>
  );
}

export { CompanyLogo, type CompanyLogoProps };
