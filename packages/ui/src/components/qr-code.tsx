import { QRCodeSVG } from 'qrcode.react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

type QrCodeProps = Omit<ComponentProps<'figure'>, 'children'> & {
  /** What the code holds, e.g. an authenticator's `otpauth://` URI. */
  value: string;
  /** Accessible name of the image, e.g. "QR code for the authenticator app". */
  label: string;
};

/**
 * A QR code for a phone to scan (two-factor enrolment). Always dark on white with a quiet zone,
 * in both themes: scanners do not all read an inverted code.
 */
function QrCode({ value, label, className, ...props }: QrCodeProps) {
  return (
    <figure
      data-slot="qr-code"
      className={cn('inline-flex rounded-md bg-white p-3 text-neutral-950', className)}
      {...props}
    >
      <QRCodeSVG
        value={value}
        title={label}
        role="img"
        aria-label={label}
        size={176}
        level="M"
        fgColor="currentColor"
        bgColor="transparent"
      />
    </figure>
  );
}

export { QrCode, type QrCodeProps };
