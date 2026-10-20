'use client';

import { type Density, type DensityPreference, resolveDensity } from '@vertex-mizan/tokens';
import { useCallback, useSyncExternalStore } from 'react';
import { densityStorageKey } from './theme';

/** The media query of a coarse primary pointer: `auto` resolves to comfortable under it. */
export const coarsePointerQuery = '(pointer: coarse)';

const listeners = new Set<() => void>();
let media: MediaQueryList | undefined;

function currentPreference(): DensityPreference {
  const chosen = document.documentElement.getAttribute('data-density');
  return chosen === 'compact' || chosen === 'comfortable' ? chosen : 'auto';
}

function coarse(): boolean {
  try {
    return matchMedia(coarsePointerQuery).matches;
  } catch {
    return false;
  }
}

/** The preference and the density it resolves to, as one string the store can compare. */
function snapshot(): `${DensityPreference}:${Density}` {
  const preference = currentPreference();
  return `${preference}:${resolveDensity(preference, coarse())}`;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    try {
      media = matchMedia(coarsePointerQuery);
      media.addEventListener('change', notify);
    } catch {
      media = undefined;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      media?.removeEventListener('change', notify);
      media = undefined;
    }
  };
}

/** Applies a density preference now and keeps it on this device (`auto` clears the choice). */
export function setDensity(next: DensityPreference): void {
  const root = document.documentElement;
  if (next === 'auto') root.removeAttribute('data-density');
  else root.setAttribute('data-density', next);
  try {
    if (next === 'auto') localStorage.removeItem(densityStorageKey);
    else localStorage.setItem(densityStorageKey, next);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  notify();
}

/**
 * The person's density preference and the density in force: compact, or comfortable on a coarse
 * primary pointer while the preference is `auto` (ADR 0010 §2). The server render assumes compact.
 */
export function useDensity(): {
  preference: DensityPreference;
  density: Density;
  setDensity: (next: DensityPreference) => void;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'auto:compact' as const);
  const [preference, density] = value.split(':') as [DensityPreference, Density];
  const set = useCallback((next: DensityPreference) => setDensity(next), []);
  return { preference, density, setDensity: set };
}
