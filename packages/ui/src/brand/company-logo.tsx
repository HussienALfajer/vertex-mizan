import { Building2Icon } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
import { cn } from '../lib/cn';

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
  lg: 'h-28 max-w-80',
};

const iconSizes = { sm: 'size-7', md: 'size-12', lg: 'size-16' };

/**
 * A company's own logo (S13, ADR 0024 §7): the image the company uploaded, kept whole in its box
 * (never cropped or stretched), or a generic building icon when it has none or the image fails to
 * load: never the product's own mark (ADR 0024 §8). The image comes from the company, so it is
 * shown as given, never recolored.
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
      ) : label ? (
        <span role="img" aria-label={label} className="inline-flex">
          <Building2Icon aria-hidden="true" className={cn('text-current', iconSizes[size])} />
        </span>
      ) : (
        <Building2Icon aria-hidden="true" className={cn('text-current', iconSizes[size])} />
      )}
    </span>
  );
}

export { CompanyLogo, type CompanyLogoProps };
