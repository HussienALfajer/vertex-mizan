import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a color beside the density font size, and the other way round', () => {
    expect(cn('text-control text-primary-foreground')).toBe('text-control text-primary-foreground');
    expect(cn('text-foreground text-control')).toBe('text-foreground text-control');
    expect(cn('text-control text-negative')).toBe('text-control text-negative');
  });

  it('still lets a later size or color replace an earlier one', () => {
    expect(cn('text-control', 'text-lg')).toBe('text-lg');
    expect(cn('text-foreground', 'text-negative')).toBe('text-negative');
    expect(cn('h-control', 'h-row')).toBe('h-row');
    expect(cn('px-cell', 'px-2')).toBe('px-2');
  });
});
