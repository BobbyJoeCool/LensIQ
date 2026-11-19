import { useEffect, useState } from 'react';

/** Tracks a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Desktop layout (Tailwind's `md`): inline cell editing. Below it, rows open the panel (Q13). */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
