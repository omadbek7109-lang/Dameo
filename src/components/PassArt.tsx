/**
 * DAMEO Pass artwork — every reward is drawn here as its own SVG (no external images except shop items),
 * with CSS effects by rarity: shine sweep, glow pulse, twinkling sparks, rotating rays (legendary / mythic).
 * Also: status emoji next to a name (like Telegram Premium), avatar frames, profile backgrounds, badges, titles.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { COSMETIC_ART, EMOJI_ART, FRAME_FIT, type Reward } from '../services/pass/core.ts';
import { PASS_EVENT } from '../services/pass/index.ts';
import { wornOf, type Worn } from '../services/pass/index.ts';

const art = (p: string) => new URL(p, document.baseURI).href;

/* ================================================================ shared bits */
function Sparks({ n = 4, color = '#fff7d1' }: { n?: number; color?: string }) {
  const pts = [
    [10, 12],
    [54, 10],
    [56, 46],
    [8, 50],
    [32, 4],
    [60, 28],
  ].slice(0, n);
  return (
    <g className="pa-sparks">
      {pts.map(([x, y], i) => (
        <path key={i} className="pa-spark" style={{ animationDelay: `${i * 0.45}s` }} d={`M${x} ${y - 3}L${x + 0.9} ${y - 0.9}L${x + 3} ${y}L${x + 0.9} ${y + 0.9}L${x} ${y + 3}L${x - 0.9} ${y + 0.9}L${x - 3} ${y}L${x - 0.9} ${y - 0.9}Z`} fill={color} />
      ))}
    </g>
  );
}

function Coin({ x, y, id, r = 11 }: { x: number; y: number; id: string; r?: number }) {
  const ry = r * 0.42;
  return (
    <g>
      <path d={`M${x - r} ${y}v3a${r} ${ry} 0 0 0 ${2 * r} 0v-3`} fill={`url(#${id}-edge)`} stroke="#78350f" strokeWidth="0.7" />
      <ellipse cx={x} cy={y} rx={r} ry={ry} fill={`url(#${id}-goldr)`} stroke="#92400e" strokeWidth="0.8" />
      <ellipse cx={x} cy={y} rx={r * 0.72} ry={ry * 0.7} fill="none" stroke="#fffbe0" strokeOpacity="0.75" strokeWidth="0.8" />
      <path d={`M${x - 3.6} ${y + 1}l1-2.8 2.6 1.6 2.6-1.6 1 2.8z`} fill="#b45309" />
      <path d={`M${x - r * 0.7} ${y - ry * 0.35}a${r * 0.8} ${ry * 0.6} 0 0 1 ${r * 0.9} -${ry * 0.55}`} fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}
function GoldDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fffbe0" />
        <stop offset="0.25" stopColor="#fde68a" />
        <stop offset="0.55" stopColor="#f59e0b" />
        <stop offset="0.8" stopColor="#b45309" />
        <stop offset="1" stopColor="#fcd34d" />
      </linearGradient>
      <radialGradient id={`${id}-goldr`} cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#fffbe6" />
        <stop offset="0.35" stopColor="#fcd34d" />
        <stop offset="0.75" stopColor="#d97706" />
        <stop offset="1" stopColor="#92400e" />
      </radialGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b45309" />
        <stop offset="0.5" stopColor="#f59e0b" />
        <stop offset="1" stopColor="#78350f" />
      </linearGradient>
      <linearGradient id={`${id}-violet`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e9d5ff" />
        <stop offset="0.3" stopColor="#a855f7" />
        <stop offset="0.7" stopColor="#6d28d9" />
        <stop offset="1" stopColor="#2e1065" />
      </linearGradient>
      <radialGradient id={`${id}-violetr`} cx="0.35" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#f3e8ff" />
        <stop offset="0.3" stopColor="#c084fc" />
        <stop offset="0.7" stopColor="#7e22ce" />
        <stop offset="1" stopColor="#3b0764" />
      </radialGradient>
      <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.45" stopColor="#cbd5e1" />
        <stop offset="0.75" stopColor="#64748b" />
        <stop offset="1" stopColor="#e2e8f0" />
      </linearGradient>
      <linearGradient id={`${id}-hl`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fde68a" stopOpacity="0.9" />
        <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
      </radialGradient>
      <filter id={`${id}-sh`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#1a0533" floodOpacity="0.7" />
      </filter>
    </defs>
  );
}

/** a jewelled crown, used by many pieces of art */
function Crown({ id, x = 32, y = 30, w = 40 }: { id: string; x?: number; y?: number; w?: number }) {
  const k = w / 40;
  return (
    <g transform={`translate(${x - 20 * k} ${y - 14 * k}) scale(${k})`} filter={`url(#${id}-sh)`}>
      <path d="M2 26L0 6l10 8 10-14 10 14 10-8-2 20z" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M3 9l7 6 10-13 10 13 7-6" fill="none" stroke="#fffbe0" strokeWidth="1" strokeOpacity="0.8" />
      <rect x="2" y="24" width="36" height="6" rx="1.5" fill={`url(#${id}-edge)`} stroke="#7c2d12" strokeWidth="1" />
      <circle cx="0" cy="6" r="2.4" fill="#fde68a" stroke="#92400e" strokeWidth="0.8" />
      <circle cx="20" cy="0" r="2.6" fill="#fde68a" stroke="#92400e" strokeWidth="0.8" />
      <circle cx="40" cy="6" r="2.4" fill="#fde68a" stroke="#92400e" strokeWidth="0.8" />
      <circle cx="11" cy="27" r="1.8" fill="#ef4444" />
      <path d="M20 18l3 4-3 4-3-4z" fill="#a855f7" stroke="#f3e8ff" strokeWidth="0.6" />
      <circle cx="29" cy="27" r="1.8" fill="#22c55e" />
    </g>
  );
}

/** rising embers for legendary / mythic rewards */
function Particles({ n }: { n: number }) {
  return (
    <span className="pa-parts" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.31) % 2.4}s`, animationDuration: `${1.8 + ((i * 7) % 10) / 10}s` }} />
      ))}
    </span>
  );
}

/** electric arcs that flicker around premium rewards */
function Bolts({ gold = true }: { gold?: boolean }) {
  const c = gold ? '#fde68a' : '#d8b4fe';
  return (
    <svg className="pa-bolts" viewBox="0 0 64 64" aria-hidden>
      <path className="pa-bolt pa-bolt-1" d="M6 10l7 7-4 2 8 9" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path className="pa-bolt pa-bolt-2" d="M58 14l-6 6 4 3-7 8" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path className="pa-bolt pa-bolt-3" d="M54 56l-7-5 3-3-8-5" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path className="pa-bolt pa-bolt-4" d="M8 54l6-6-3-3 7-6" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CoinStack({ amount, id }: { amount: number; id: string }) {
  const n = amount >= 500 ? 5 : amount >= 150 ? 4 : amount >= 100 ? 3 : 2;
  const spots: [number, number][] = [
    [26, 46],
    [40, 44],
    [33, 38],
    [22, 34],
    [42, 31],
  ];
  return (
    <>
      {spots.slice(0, n).map(([x, y], i) => (
        <g key={i}>
          <Coin x={x} y={y} id={id} />
          <Coin x={x} y={y - 4} id={id} />
        </g>
      ))}
    </>
  );
}

/* ================================================================ status emoji (also used next to names) */
export function EmojiArt({ id, size = 20, className = '' }: { id: string; size?: number; className?: string }) {
  const u = useId().replace(/:/g, '');
  if (EMOJI_ART[id]) return <img className={`pa-emoji ${className}`} src={art(EMOJI_ART[id])} width={size} height={size} alt="" aria-hidden draggable={false} />;
  const body = (() => {
    switch (id) {
      case 'e-piece':
        return (
          <>
            <ellipse cx="32" cy="44" rx="28" ry="12" fill="#0b0f1a" />
            <rect x="4" y="34" width="56" height="10" fill="#1f2937" />
            <ellipse cx="32" cy="34" rx="28" ry="12" fill={`url(#${u}-dark)`} stroke="#9ca3af" strokeWidth="1.5" />
            <ellipse cx="32" cy="34" rx="19" ry="7.5" fill="none" stroke="#a78bfa" strokeWidth="2" />
            <path d="M21 37l-3-14 9 6 5-10 5 10 9-6-3 14z" fill={`url(#${u}-gold)`} stroke="#92400e" strokeWidth="1" />
          </>
        );
      case 'e-crown':
        return (
          <>
            <rect x="6" y="8" width="52" height="42" rx="13" fill={`url(#${u}-violetr)`} stroke="#3b0764" strokeWidth="1.2" />
            <path d="M22 50l8 8v-8z" fill="#5b21b6" />
            <path d="M10 14q8-5 22-5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.2" strokeLinecap="round" />
            <Crown id={u} y={31} w={34} />
          </>
        );
      case 'e-win':
        return (
          <>
            <rect x="4" y="16" width="56" height="32" rx="8" fill="#047857" />
            <rect x="6" y="18" width="52" height="26" rx="6" fill="#10b981" />
            <text x="32" y="38" textAnchor="middle" fontSize="17" fontWeight="900" fill="#ecfdf5" fontFamily="system-ui, sans-serif">
              WIN
            </text>
          </>
        );
      case 'e-diamond':
        return (
          <g filter={`url(#${u}-sh)`}>
            <path d="M10 22l11-13h22l11 13-22 33z" fill="#7c3aed" stroke="#2e1065" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M10 22h44L32 55z" fill="#6d28d9" />
            <path d="M21 9l-11 13h14zM43 9l11 13H40z" fill="#c4b5fd" />
            <path d="M24 22l8-13 8 13z" fill="#ede9fe" />
            <path d="M24 22l8 33 8-33z" fill="#a78bfa" />
            <path d="M14 21l8-9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        );
      case 'e-gold-crown':
        return <Crown id={u} y={34} w={56} />;
      case 'e-smile':
        return (
          <>
            <circle cx="32" cy="32" r="24" fill={`url(#${u}-goldr)`} stroke="#b45309" strokeWidth="1.5" />
            <circle cx="24" cy="28" r="3" fill="#3b0764" />
            <circle cx="40" cy="28" r="3" fill="#3b0764" />
            <path d="M21 37q11 11 22 0" stroke="#3b0764" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        );
      case 'e-heart':
        return <path d="M32 54C8 38 10 16 24 14c5-1 7 3 8 6 1-3 3-7 8-6 14 2 16 24-8 40z" fill="#f472b6" stroke="#9d174d" strokeWidth="1.5" />;
      case 'e-star':
        return <path d="M32 6l7.6 16.4 17.9 2-13.3 12.2 3.7 17.7L32 45.3 16.1 54.3l3.7-17.7L6.5 24.4l17.9-2z" fill={`url(#${u}-gold)`} stroke="#92400e" strokeWidth="1.4" strokeLinejoin="round" />;
      case 'e-fire':
        return (
          <>
            <path d="M32 6c3 10 16 16 16 30a16 16 0 01-32 0c0-8 5-12 7-18 2 5 4 7 6 8-1-8 1-14 3-20z" fill="#f97316" />
            <path d="M32 26c2 6 9 9 9 17a9 9 0 01-18 0c0-5 3-7 4-10 1 3 2 4 4 5-1-5 0-8 1-12z" fill="#fde047" />
          </>
        );
      default:
        return <circle cx="32" cy="32" r="20" fill="#a78bfa" />;
    }
  })();
  return (
    <svg className={`pa-emoji ${className}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <GoldDefs id={u} />
      <defs>
        <linearGradient id={`${u}-dark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b5563" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
      </defs>
      {body}
    </svg>
  );
}

/* ================================================================ frames */
const FRAME_STYLE: Record<string, { cls: string; label?: string }> = {
  'f-violet': { cls: 'pf-violet' },
  'f-silver': { cls: 'pf-silver' },
  'f-gold': { cls: 'pf-gold' },
  'f-epic': { cls: 'pf-epic' },
  'f-legend': { cls: 'pf-legend' },
};
/** Wraps an avatar with a pass frame. */
export function PassFrame({ id, size, children }: { id: string | null | undefined; size: number; children: ReactNode }) {
  const u = useId().replace(/:/g, '');
  if (id && COSMETIC_ART[id] && id.startsWith('f-')) {
    // fit the avatar exactly into the frame's hole: the hole's longer side = the avatar's size,
    // the picture is scaled and shifted around it, so every frame sits the same way
    const f = FRAME_FIT[id] ?? { x: 0.18, y: 0.24, w: 0.64, h: 0.58 };
    const k = size / Math.max(f.w, f.h); // picture size in px
    const aw = Math.round(f.w * k);
    const ah = Math.round(f.h * k);
    return (
      <span className={`pf pf-fit pf-${id}`} style={{ width: size, height: size }}>
        <span className="pf-in" style={{ width: aw + 2, height: ah + 2 }}>
          {children}
        </span>
        <img
          className="pf-art"
          src={art(COSMETIC_ART[id])}
          alt=""
          aria-hidden
          style={{ width: k, height: k, left: size / 2 - k * (f.x + f.w / 2), top: size / 2 - k * (f.y + f.h / 2) }}
        />
      </span>
    );
  }
  if (!id || !FRAME_STYLE[id]) return <>{children}</>;
  const crown = id === 'f-gold' || id === 'f-legend';
  return (
    <span className={`pf ${FRAME_STYLE[id].cls}`} style={{ width: size, height: size, ['--pf' as string]: `${size}px` }}>
      <span className="pf-ring" aria-hidden />
      {id === 'f-legend' && (
        <>
          <span className="pf-wing pf-wing-l" aria-hidden />
          <span className="pf-wing pf-wing-r" aria-hidden />
        </>
      )}
      <span className="pf-in">{children}</span>
      {crown && (
        <svg className="pf-crown" viewBox="0 0 64 44" aria-hidden>
          <GoldDefs id={u} />
          <Crown id={u} y={24} w={52} />
        </svg>
      )}
    </span>
  );
}
function FrameArt({ id }: { id: string }) {
  return (
    <span className="pa-frame-art">
      <PassFrame id={id} size={34}>
        <span className="pa-frame-face" />
      </PassFrame>
    </span>
  );
}

/* ================================================================ backgrounds */
export function ProfileBg({ id, className = '' }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  if (COSMETIC_ART[id] && id.startsWith('bg-'))
    return (
      <span className={`pbg pbg-img ${className}`} aria-hidden>
        <img src={art(COSMETIC_ART[id])} alt="" />
        <span className="pbg-stars" />
      </span>
    );
  return (
    <span className={`pbg pbg-${id} ${className}`} aria-hidden>
      {id === 'bg-night' && (
        <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice">
          <circle cx="320" cy="44" r="22" fill="#f5f3ff" opacity="0.92" />
          <circle cx="330" cy="38" r="20" fill="#2e1065" opacity="0.35" />
          <path d="M0 160L70 80l50 50 70-90 80 100 60-60 70 80z" fill="#4c1d95" />
          <path d="M0 160l90-60 60 40 80-70 90 90 80-50v50z" fill="#2e1065" />
        </svg>
      )}
      {id === 'bg-palace' && (
        <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice">
          <path d="M120 160V96h20V70l10-14 10 14v26h20V60l20-26 20 26v36h20V70l10-14 10 14v26h20v64z" fill="#78350f" opacity="0.85" />
          <path d="M190 34l10-18 10 18z" fill="#fbbf24" />
        </svg>
      )}
      {id === 'bg-cosmos' && (
        <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="330" cy="110" r="34" fill="#7c3aed" />
          <ellipse cx="330" cy="110" rx="58" ry="10" fill="none" stroke="#f0abfc" strokeWidth="3" transform="rotate(-18 330 110)" />
          <circle cx="60" cy="40" r="6" fill="#93c5fd" />
        </svg>
      )}
      <span className="pbg-stars" />
    </span>
  );
}
function BgArt({ id }: { id: string }) {
  return (
    <span className="pa-bg-art">
      <ProfileBg id={id} />
    </span>
  );
}

/* ================================================================ badges and titles */
export function BadgeArt({ id, size = 40 }: { id: string; size?: number }) {
  const u = useId().replace(/:/g, '');
  if (COSMETIC_ART[id]) return <img className="pa-badge" src={art(COSMETIC_ART[id])} width={size} height={size} alt="" aria-hidden />;
  const gold = id === 'b-s1-gold';
  const leaf = gold ? `url(#${u}-gold)` : `url(#${u}-silver)`;
  return (
    <svg className="pa-badge" viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <GoldDefs id={u} />
      <g filter={`url(#${u}-sh)`}>
        {[0, 1].map((side) => (
          <g key={side} transform={side ? 'translate(64 0) scale(-1 1)' : undefined}>
            <path d="M24 56C10 50 6 36 10 20" fill="none" stroke={gold ? '#b45309' : '#64748b'} strokeWidth="2" />
            {[0, 1, 2, 3, 4].map((i) => {
              const t = i / 4;
              const cx = 10 + (1 - t) * 6 - t * 1;
              const cy = 52 - t * 32;
              return <ellipse key={i} cx={cx} cy={cy} rx="3.6" ry="7" transform={`rotate(${-50 + i * 16} ${cx} ${cy})`} fill={leaf} stroke={gold ? '#92400e' : '#475569'} strokeWidth="0.6" />;
            })}
          </g>
        ))}
        <circle cx="32" cy="32" r="16" fill={gold ? `url(#${u}-goldr)` : `url(#${u}-silver)`} stroke={gold ? '#7c2d12' : '#334155'} strokeWidth="1.2" />
        <circle cx="32" cy="32" r="12.5" fill={gold ? '#451a03' : '#1e293b'} />
        <text x="32" y="38" textAnchor="middle" fontSize="15" fontWeight="900" fill={gold ? '#fde68a' : '#f1f5f9'} fontFamily="system-ui, sans-serif" fontStyle="italic">
          S1
        </text>
        {gold && <Crown id={u} y={12} w={18} />}
      </g>
    </svg>
  );
}
const TITLE_STYLE: Record<string, string> = { 't-active': 'pt-violet', 't-elite': 'pt-gold', 't-champion': 'pt-champ', 't-immortal': 'pt-champ', 't-royal': 'pt-gold' };
export const TITLE_NAME: Record<string, { uz: string; en: string }> = {
  't-active': { uz: "Faol o'yinchi", en: 'Active player' },
  't-elite': { uz: 'Dameo Elite', en: 'Dameo Elite' },
  't-champion': { uz: "Chempion da'vogar", en: 'Title contender' },
  't-immortal': { uz: 'Immortal', en: 'Immortal' },
  't-royal': { uz: 'Royal Player', en: 'Royal Player' },
};
export function TitleTag({ id, lang }: { id: string; lang: 'uz' | 'en' }) {
  const n = TITLE_NAME[id];
  if (!n) return null;
  return (
    <span className={`pt ${TITLE_STYLE[id] ?? ''}`}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
        <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" fill="currentColor" />
      </svg>
      {lang === 'en' ? n.en : n.uz}
    </span>
  );
}
function TitleArt({ id, u }: { id: string; u: string }) {
  const gold = id !== 't-active';
  const fill = gold ? `url(#${u}-gold)` : `url(#${u}-violetr)`;
  const tail = gold ? '#92400e' : '#4c1d95';
  return (
    <g filter={`url(#${u}-sh)`}>
      <path d="M2 28l9 6-9 6h12V28z" fill={tail} />
      <path d="M62 28l-9 6 9 6H50V28z" fill={tail} />
      <path d="M12 24h40l-2 10 2 10H12l2-10z" fill={fill} stroke={gold ? '#7c2d12' : '#2e1065'} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M14 26h36" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.4" />
      <path d="M32 27.5l2 4.3 4.7.6-3.5 3.2.9 4.6L32 38l-4.1 2.2.9-4.6-3.5-3.2 4.7-.6z" fill={gold ? '#7c2d12' : '#fde68a'} />
      {id === 't-champion' && <Crown id={u} y={16} w={26} />}
      {id === 't-elite' && <path d="M22 20l3-6 3 6M36 20l3-6 3 6" stroke="#fde68a" strokeWidth="1.4" fill="none" />}
    </g>
  );
}

/* ================================================================ other rewards */
function XpTicket({ pct, id }: { pct: number; id: string }) {
  const hot = pct >= 50;
  const blue = pct === 20;
  const fill = hot ? `url(#${id}-gold)` : blue ? '#2563eb' : `url(#${id}-violetr)`;
  return (
    <g transform="rotate(-14 32 32)" filter={`url(#${id}-sh)`}>
      <path d="M5 17h54v10a5 5 0 000 10v10H5V37a5 5 0 000-10z" fill={fill} stroke={hot ? '#7c2d12' : '#1e1b4b'} strokeWidth="1.3" />
      <path d="M8 20h48" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.4" />
      <path d="M46 19v26" stroke={hot ? '#92400e' : '#e0e7ff'} strokeWidth="1" strokeDasharray="2 2" />
      {blue ? (
        <path d="M27 21l-7 13h6l-3 10 10-14h-6l4-9z" fill="#fde68a" stroke="#1e3a8a" strokeWidth="0.8" />
      ) : (
        <text x="26" y="37" textAnchor="middle" fontSize="15" fontWeight="900" fill={hot ? '#7c2d12' : '#fff'} fontFamily="system-ui, sans-serif" fontStyle="italic">
          XP
        </text>
      )}
      <text x="52.5" y="34.5" textAnchor="middle" fontSize="6.5" fontWeight="900" fill={hot ? '#7c2d12' : '#fde68a'} fontFamily="system-ui, sans-serif" transform="rotate(90 52.5 32)">
        +{pct}%
      </text>
    </g>
  );
}
function Box({ id, kind }: { id: string; kind: string }) {
  if (kind === 'box-bag')
    return (
      <g filter={`url(#${id}-sh)`}>
        <path d="M21 22c-12 8-16 32 11 32s23-24 11-32z" fill={`url(#${id}-violetr)`} stroke="#2e1065" strokeWidth="1.2" />
        <path d="M23 22l-5-10c6 3 22 3 28 0l-5 10z" fill="#7e22ce" stroke="#2e1065" strokeWidth="1" />
        <rect x="21" y="19.5" width="22" height="4.5" rx="2.2" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="0.8" />
        <path d="M20 32q2-6 7-8" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <Crown id={id} y={41} w={18} />
      </g>
    );
  const epic = kind === 'box-epic';
  return (
    <g filter={`url(#${id}-sh)`}>
      {epic && <ellipse cx="32" cy="28" rx="22" ry="8" fill={`url(#${id}-glow)`} />}
      <rect x="8" y="30" width="48" height="24" rx="3" fill={epic ? '#7e22ce' : '#6d28d9'} stroke="#2e1065" strokeWidth="1.2" />
      <path d="M8 31c0-14 48-14 48 0z" fill={`url(#${id}-violetr)`} stroke="#2e1065" strokeWidth="1.2" />
      <path d="M12 26q8-8 20-8" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <rect x="8" y="29" width="48" height="4.5" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="0.6" />
      <rect x="8" y="49" width="48" height="4" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="0.6" />
      <rect x="15" y="18" width="5" height="36" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="0.6" />
      <rect x="44" y="18" width="5" height="36" fill={`url(#${id}-gold)`} stroke="#7c2d12" strokeWidth="0.6" />
      <path d="M26 31h12v10l-6 4-6-4z" fill={`url(#${id}-goldr)`} stroke="#7c2d12" strokeWidth="1" />
      <circle cx="32" cy="37" r="2.6" fill={epic ? '#ec4899' : '#3b82f6'} stroke="#fff" strokeWidth="0.8" />
      {epic && (
        <>
          <path d="M28 22l4-5 4 5-4 4z" fill="#22d3ee" stroke="#ecfeff" strokeWidth="0.7" />
          <circle cx="17.5" cy="41" r="1.8" fill="#ef4444" />
          <circle cx="46.5" cy="41" r="1.8" fill="#22c55e" />
        </>
      )}
    </g>
  );
}
function FxArt({ slug, id }: { slug: string; id: string }) {
  return (
    <g>
      {slug === 'fx-ripple' &&
        [11, 17, 23].map((r, i) => (
          <ellipse key={r} className="pa-ripple" style={{ animationDelay: `${i * 0.45}s` }} cx="32" cy="42" rx={r} ry={r * 0.42} fill="none" stroke="#a855f7" strokeWidth="2.2" />
        ))}
      {slug === 'fx-ripple' && <ellipse cx="32" cy="42" rx="24" ry="10" fill="none" stroke="#e879f9" strokeWidth="1" strokeOpacity="0.6" />}
      {slug === 'fx-fire' && (
        <>
          <path className="pa-flame" d="M10 46c-3-12 7-16 7-28 7 7 7 13 11 13 0-10 5-14 9-22 3 12 15 17 15 37z" fill="#ea580c" />
          <path className="pa-flame" style={{ animationDelay: '.2s' }} d="M18 46c0-8 5-10 6-17 4 5 5 8 7 8 0-5 3-8 5-12 3 8 8 11 8 21z" fill="#fb923c" />
          <path d="M24 46c0-5 3-6 4-10 2 3 3 5 4 5 0-3 2-5 3-7 2 5 5 7 5 12z" fill="#fde047" />
        </>
      )}
      {slug === 'fx-sparkle' && (
        <>
          <path d="M6 30c8-10 14-12 20-8M58 30c-8-10-14-12-20-8" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="5" strokeLinecap="round" />
          <path d="M4 24c8-8 16-8 22-2M60 24c-8-8-16-8-22-2" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinecap="round" />
          <Sparks n={6} color="#fde68a" />
        </>
      )}
      <path d="M18 42v4a14 5.5 0 0 0 28 0v-4" fill="#111827" />
      <ellipse cx="32" cy="42" rx="14" ry="5.5" fill={slug === 'fx-sparkle' ? `url(#${id}-goldr)` : '#1f2937'} stroke={slug === 'fx-ripple' ? '#e879f9' : '#fde68a'} strokeWidth="1.2" />
      <path d="M27 43.5l1.6-3.6 3.4 2 3.4-2 1.6 3.6z" fill="#fde68a" />
      {slug === 'fx-sparkle' && <Crown id={id} y={24} w={22} />}
    </g>
  );
}

/* ================================================================ the reward picture */
export function RewardArt({ r, premium, big }: { r: Reward; premium?: boolean; big?: boolean }) {
  const u = useId().replace(/:/g, '');
  const prem = premium ?? r.track === 'elite';
  const fx = `pa pa-${r.rarity} pa-k-${r.kind} ${prem ? 'pa-prem' : ''} ${big ? 'pa-big' : ''}`;
  const svg = (children: ReactNode) => (
    <svg className="pa-svg" viewBox="0 0 64 64" aria-hidden>
      <GoldDefs id={u} />
      {children}
      {(r.rarity === 'legendary' || r.rarity === 'mythic' || prem) && <Sparks n={r.rarity === 'mythic' ? 6 : 4} />}
    </svg>
  );
  let inner: ReactNode;
  if (r.art) {
    // lists show a still picture (many on screen = must be cheap); the big view (details / reveal) gets the effects
    if (!big)
      return (
        <span className={`pa pa-still pa-${r.rarity} pa-k-${r.kind} ${prem ? 'pa-prem' : ''}`}>
          <img className="pa-png" src={art(r.art)} alt="" loading="lazy" decoding="async" draggable={false} />
        </span>
      );
    const rare = r.rarity === 'legendary' || r.rarity === 'mythic';
    return (
      <span className={fx}>
        {(rare || prem) && <span className="pa-rays" aria-hidden />}
        {rare && <Particles n={10} />}
        <span className="pa-body">
          <img className="pa-png" src={art(r.art)} alt="" draggable={false} />
        </span>
        {prem && rare && <Bolts />}
      </span>
    );
  }
  switch (r.kind) {
    case 'coins':
      inner = svg(
        <g transform="translate(-7 -9) scale(1.22)">
          <CoinStack amount={Number(r.value)} id={u} />
        </g>,
      );
      break;
    case 'xp_boost':
      inner = svg(<XpTicket pct={Number(r.value)} id={u} />);
      break;
    case 'box':
      inner = svg(<Box id={u} kind={r.value} />);
      break;
    case 'emoji':
      inner = <EmojiArt id={r.value} size={big ? 110 : 44} className="pa-emoji-big" />;
      break;
    case 'frame':
      inner = <FrameArt id={r.value} />;
      break;
    case 'background':
      inner = <BgArt id={r.value} />;
      break;
    case 'badge':
      inner = <BadgeArt id={r.value} size={big ? 120 : 50} />;
      break;
    case 'title':
      inner = svg(<TitleArt id={r.value} u={u} />);
      break;
    case 'item':
      inner = r.value.startsWith('fx-') ? (
        svg(<FxArt slug={r.value} id={u} />)
      ) : (
        <span className="pa-item">
          <img className="pa-img" src={art(r.value.startsWith('st-') ? `stones/${r.value}.webp` : `boards/${r.value}-sm.webp`)} alt="" loading="lazy" />
          {prem && (
            <svg className="pa-item-crown" viewBox="0 0 64 64" aria-hidden>
              <GoldDefs id={u} />
              <Crown id={u} y={32} w={44} />
            </svg>
          )}
        </span>
      );
      break;
  }
  return (
    <span className={fx}>
      {(r.rarity === 'legendary' || r.rarity === 'mythic' || prem) && <span className="pa-rays" aria-hidden />}
      <span className="pa-body">{inner}</span>
      {prem && (r.rarity === 'epic' || r.rarity === 'legendary' || r.rarity === 'mythic') && <Bolts />}
      {r.rarity !== 'common' && <span className="pa-shine" aria-hidden />}
    </span>
  );
}

/* ================================================================ worn cosmetics (profile, header, menu) */
export function useWorn(userId: string | null | undefined, enabled = true): Worn {
  const [w, setW] = useState<Worn>({});
  useEffect(() => {
    if (!enabled) {
      setW({});
      return;
    }
    let alive = true;
    const load = () => wornOf(userId).then((x) => alive && setW(x), () => undefined);
    void load();
    window.addEventListener(PASS_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(PASS_EVENT, load);
    };
  }, [userId, enabled]);
  return w;
}
/** Status emoji next to a name — like the Telegram Premium icon. */
export function NameEmoji({ worn, size = 18 }: { worn: Worn; size?: number }) {
  if (!worn.emoji) return null;
  return (
    <span className="pa-name-emoji" title="DAMEO Pass">
      <EmojiArt id={worn.emoji} size={size} />
    </span>
  );
}
