// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportMenu } from './export-menu';

afterEach(cleanup);

const labels = {
  trigger: 'تصدير',
  excel: 'Excel',
  pdf: 'PDF',
  queued: 'قيد الإعداد',
  failed: 'تعذّر الإعداد',
  expired: 'انتهت صلاحيته',
  download: 'تنزيل PDF',
};

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'تصدير' }));
  });
}

describe('ExportMenu', () => {
  it('offers Excel and PDF from its menu and calls their handlers', async () => {
    const onExcel = vi.fn();
    const onPdf = vi.fn();
    render(<ExportMenu labels={labels} onExcel={onExcel} onPdf={onPdf} />);
    await openMenu();
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Excel', 'PDF']);
    await act(async () => {
      fireEvent.click(items[1] as Element);
    });
    expect(onPdf).toHaveBeenCalledOnce();
    expect(onExcel).not.toHaveBeenCalled();
  });

  it('offers only the exports that have a handler', async () => {
    render(<ExportMenu labels={labels} onExcel={vi.fn()} />);
    await openMenu();
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Excel']);
  });

  it('announces the PDF’s state, and downloads it once ready', () => {
    const onDownload = vi.fn();
    const { rerender } = render(
      <ExportMenu labels={labels} onPdf={vi.fn()} file={{ state: 'queued' }} />,
    );
    const state = screen.getByRole('status');
    expect(state.getAttribute('aria-live')).toBe('polite');
    expect(state.textContent).toBe('PDF: قيد الإعداد');
    rerender(
      <ExportMenu
        labels={labels}
        onPdf={vi.fn()}
        file={{ state: 'failed', error: 'الفترة غير مقفلة' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('PDF: تعذّر الإعداد(الفترة غير مقفلة)');
    rerender(
      <ExportMenu
        labels={labels}
        onPdf={vi.fn()}
        file={{ state: 'ready' }}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'تنزيل PDF' }));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('shows the trigger busy while an export is requested', () => {
    render(<ExportMenu labels={labels} onExcel={vi.fn()} pending="excel" />);
    expect(screen.getByRole('button', { name: 'تصدير' }).getAttribute('aria-busy')).toBe('true');
  });
});
