// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileUploadButton } from './file-upload-button';

afterEach(cleanup);

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');

describe('FileUploadButton', () => {
  it('is a named button that opens the file dialog with the accepted types', () => {
    render(
      <FileUploadButton
        label="إرفاق ملف"
        accept={['application/pdf', 'image/png']}
        multiple
        onFiles={() => {}}
      />,
    );
    const click = vi.spyOn(fileInput() as HTMLInputElement, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'إرفاق ملف' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(fileInput()?.accept).toBe('application/pdf,image/png');
    expect(fileInput()?.multiple).toBe(true);
    expect(fileInput()?.tabIndex).toBe(-1);
  });

  it('hands over the chosen files and empties the input for the next choice', () => {
    const onFiles = vi.fn();
    render(<FileUploadButton label="إرفاق ملف" accept={['application/pdf']} onFiles={onFiles} />);
    const file = new File(['%PDF-1.7'], 'فاتورة.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput() as HTMLInputElement, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(fileInput()?.value).toBe('');
    fireEvent.change(fileInput() as HTMLInputElement, { target: { files: [] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('opens nothing while disabled', () => {
    render(<FileUploadButton label="إرفاق ملف" accept={[]} onFiles={() => {}} disabled />);
    const click = vi.spyOn(fileInput() as HTMLInputElement, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'إرفاق ملف' }));
    expect(click).not.toHaveBeenCalled();
  });
});
