import { useEffect, useState } from 'react';

/**
 * The token an emailed link carries in its fragment (`#token=…`, S01 rule 15), which never reaches
 * a server log. It is read once, then removed from the address bar, so it is not left in the
 * history or shown on screen.
 */
export function useFragmentToken(): string | undefined {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? undefined,
  );
  useEffect(() => {
    if (!window.location.hash) return;
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }, []);
  return token;
}
