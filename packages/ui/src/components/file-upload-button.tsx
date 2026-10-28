import { PaperclipIcon } from 'lucide-react';
import { type ComponentProps, useRef } from 'react';
import { Button } from './button';

type FileUploadButtonProps = Omit<
  ComponentProps<typeof Button>,
  'onClick' | 'type' | 'render' | 'children'
> & {
  /** The button's text ("attach a file"). */
  label: string;
  /** The media types offered by the browser's file dialog; the server still checks each file. */
  accept: readonly string[];
  multiple?: boolean;
  /** The chosen files, in the order the dialog gives them; never called with none. */
  onFiles: (files: File[]) => void;
};

/**
 * A button that opens the browser's file dialog (S03 attachments): an ordinary button for the
 * keyboard and screen readers, over a hidden file input. The same file can be chosen again after
 * a refusal: the input is emptied after each choice.
 */
function FileUploadButton({
  label,
  accept,
  multiple = false,
  onFiles,
  variant = 'outline',
  ...props
}: FileUploadButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        data-slot="file-upload-button"
        type="button"
        variant={variant}
        onClick={() => input.current?.click()}
        {...props}
      >
        <PaperclipIcon aria-hidden="true" />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        accept={accept.join(',')}
        multiple={multiple}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

export { FileUploadButton, type FileUploadButtonProps };
