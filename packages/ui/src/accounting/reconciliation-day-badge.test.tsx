// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { RECONCILIATION_DAY_STATES } from '@vertex-mizan/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ReconciliationDayBadge } from './reconciliation-day-badge';

afterEach(cleanup);

describe('ReconciliationDayBadge', () => {
  it('names every state in words with its icon, never by color alone', () => {
    for (const state of RECONCILIATION_DAY_STATES) {
      const { unmount } = render(<ReconciliationDayBadge state={state} label={`يوم ${state}`} />);
      const badge = screen.getByText(`يوم ${state}`);
      expect(
        badge.closest('[data-slot="reconciliation-day-badge"]')?.getAttribute('data-state'),
      ).toBe(state);
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });

  it('gives each state its own tone', () => {
    const tones = RECONCILIATION_DAY_STATES.map((state) => {
      const { container, unmount } = render(<ReconciliationDayBadge state={state} label={state} />);
      const tone = container.querySelector('[data-slot="badge"]')?.className ?? '';
      unmount();
      return /bg-status-(\w+)/.exec(tone)?.[1];
    });
    expect(tones).toEqual(['neutral', 'info', 'warning', 'danger', 'success']);
  });

  it('shows a detail beside the state, and nothing without one', () => {
    render(<ReconciliationDayBadge state="differences" label="فيه فروق" detail="2 فرق" />);
    const root = document.querySelector('[data-slot="reconciliation-day-badge"]');
    expect(root?.textContent).toBe('فيه فروق2 فرق');
    cleanup();
    render(<ReconciliationDayBadge state="matched" label="مطابق" detail={null} />);
    expect(document.querySelector('[data-slot="reconciliation-day-badge"]')?.textContent).toBe(
      'مطابق',
    );
  });

  it('shows a state it does not know as neutral, with an icon (ADR 0006)', () => {
    render(<ReconciliationDayBadge state={'held' as 'matched'} label="?" />);
    const badge = document.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain('bg-status-neutral');
    expect(badge?.querySelector('svg')).not.toBeNull();
  });
});
