import { useEffect, useState } from 'react';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animates a number from `from` to `to`. Jumps straight to the end when reduced motion is requested. */
export function useCountUp(from: number, to: number, ms = 1100, active = true): number {
  const [v, setV] = useState(active ? from : to);
  useEffect(() => {
    if (!active) {
      setV(to);
      return;
    }
    if (prefersReducedMotion() || from === to) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, ms, active]);
  return v;
}
