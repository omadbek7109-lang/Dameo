import { useMemo } from 'react';
import { prefersReducedMotion } from '../hooks/useCountUp.ts';

/** Victory celebration: pure CSS, deterministic pieces, disabled for reduced motion. */
export function Confetti({ count = 36 }: { count?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: (i * 97) % 100,
        delay: ((i * 53) % 100) / 100,
        dur: 2.2 + ((i * 31) % 15) / 10,
        hue: i % 3 === 0 ? 'var(--gold)' : i % 3 === 1 ? 'var(--accent)' : 'var(--text)',
        rot: (i * 47) % 360,
        w: 6 + (i % 4) * 2,
      })),
    [count],
  );
  if (prefersReducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.hue, width: b.w, height: b.w * 1.6, transform: `rotate(${b.rot}deg)` }} />
      ))}
    </div>
  );
}
