// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { EVENT_STATES } from '@vertex-mizan/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { EventStateBadge } from './event-state-badge';

afterEach(cleanup);

describe('EventStateBadge', () => {
  it('names every state in words with its icon, never by color alone', () => {
    for (const state of EVENT_STATES) {
      const { unmount } = render(<EventStateBadge state={state} label={`حالة ${state}`} />);
      const badge = screen.getByText(`حالة ${state}`);
      expect(badge.closest('[data-slot="event-state-badge"]')?.getAttribute('data-state')).toBe(
        state,
      );
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });

  it('gives each state its own tone', () => {
    const tones = EVENT_STATES.map((state) => {
      const { container, unmount } = render(<EventStateBadge state={state} label={state} />);
      const tone = container.querySelector('[data-slot="badge"]')?.className ?? '';
      unmount();
      return /bg-status-(\w+)/.exec(tone)?.[1];
    });
    expect(tones).toEqual(['warning', 'success', 'info', 'brand', 'neutral']);
  });

  it('shows a held event’s reason beside its state, and nothing without one', () => {
    render(<EventStateBadge state="held" label="معلّق" reason="سعر غير موجود" />);
    const root = document.querySelector('[data-slot="event-state-badge"]');
    expect(root?.textContent).toBe('معلّقسعر غير موجود');
    cleanup();
    render(<EventStateBadge state="posted" label="مرحّل" reason={null} />);
    expect(document.querySelector('[data-slot="event-state-badge"]')?.textContent).toBe('مرحّل');
  });

  it('shows a state it does not know as neutral (ADR 0006)', () => {
    render(<EventStateBadge state={'archived' as 'posted'} label="?" />);
    expect(document.querySelector('[data-slot="badge"]')?.className).toContain('bg-status-neutral');
  });
});
