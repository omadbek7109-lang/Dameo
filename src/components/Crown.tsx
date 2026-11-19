import { useId } from 'react';

/**
 * DAMEO premium king crown: a gold crown with depth (lit front, shaded band), gems and a highlight.
 * Drop-in for the old icon: same `piece-crown` class, so size / position rules still apply.
 */
export function Crown({ className = 'piece-crown' }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = `cg${id}`;
  const b = `cb${id}`;
  const r = `cr${id}`;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset="0.35" stopColor="#ffd35a" />
          <stop offset="0.7" stopColor="#e3a21c" />
          <stop offset="1" stopColor="#9a6406" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6c445" />
          <stop offset="1" stopColor="#8a5703" />
        </linearGradient>
        <radialGradient id={r} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="var(--gem, #ff4d6d)" />
          <stop offset="1" stopColor="#3b0712" />
        </radialGradient>
      </defs>
      {/* back points */}
      <path d="M10 44 L7 18 L20 29 L32 10 L44 29 L57 18 L54 44 Z" fill={`url(#${g})`} stroke="#7a4d02" strokeWidth="1.6" strokeLinejoin="round" />
      {/* inner shading of the points */}
      <path d="M14 40 L12.5 25 L21 33 L32 17 L43 33 L51.5 25 L50 40 Z" fill="#000" opacity="0.12" />
      {/* band */}
      <rect x="9" y="42" width="46" height="11" rx="3" fill={`url(#${b})`} stroke="#7a4d02" strokeWidth="1.6" />
      <rect x="12" y="44" width="40" height="2.4" rx="1.2" fill="#fff4c4" opacity="0.7" />
      {/* gems */}
      <circle cx="32" cy="47.6" r="3.6" fill={`url(#${r})`} stroke="#5a3a02" strokeWidth="0.8" />
      <circle cx="20" cy="47.6" r="2.4" fill="#7fd3ff" stroke="#5a3a02" strokeWidth="0.7" />
      <circle cx="44" cy="47.6" r="2.4" fill="#7fd3ff" stroke="#5a3a02" strokeWidth="0.7" />
      {/* tips */}
      <circle cx="7" cy="17.5" r="3.4" fill={`url(#${g})`} stroke="#7a4d02" strokeWidth="1.2" />
      <circle cx="32" cy="9" r="3.8" fill={`url(#${g})`} stroke="#7a4d02" strokeWidth="1.2" />
      <circle cx="57" cy="17.5" r="3.4" fill={`url(#${g})`} stroke="#7a4d02" strokeWidth="1.2" />
      {/* specular */}
      <path d="M16 38 L14.6 27 L20 32" fill="none" stroke="#fffbe6" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <circle cx="30.6" cy="7.8" r="1.1" fill="#fff" opacity="0.9" />
    </svg>
  );
}
