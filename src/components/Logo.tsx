import { useId } from 'react';

/** DAMEO mark: a checkers piece whose face is the letter D, crowned. */
export function LogoMark({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="DAMEO" className="logo-mark">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ba6ff" />
          <stop offset="1" stopColor="#1f4fd8" />
        </linearGradient>
        <linearGradient id={`c${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd978" />
          <stop offset="1" stopColor="#e0a526" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="35" r="26" fill="#0b1a4a" opacity=".35" transform="translate(0 2.500)" />
      <circle cx="32" cy="34" r="26" fill={`url(#g${id})`} />
      <circle cx="32" cy="34" r="20.500" fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="1.500" />
      <path d="M23 25h10.500c7 0 11 4 11 9.500S40.500 44 33.500 44H23z" fill="#fff" />
      <path d="M29 30h4.200c3.200 0 5 1.900 5 4.500S36.400 39 33.200 39H29z" fill="#2457de" />
      <path d="M20 19.500l4.600 3.800 3.900-6 3.500 5.300 3.500-5.300 3.900 6 4.600-3.800-1.800 7.600H21.800z" fill={`url(#c${id})`} stroke="#b98310" strokeWidth=".6" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 36, showTagline = false }: { size?: number; showTagline?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-text">
        <span className="logo-word">DAMEO</span>
        {showTagline && <span className="logo-tag">Every Move Matters.</span>}
      </span>
    </span>
  );
}
