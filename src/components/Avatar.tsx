import { useId, useState } from 'react';
import type { IconType } from 'react-icons';
import { LuCrown, LuFlame, LuGem, LuShield, LuSparkles, LuStar, LuSun } from 'react-icons/lu';
import type { Player } from '../types/models.ts';
import { levelOf, levelTier } from '../services/levels.ts';
import { useFrames } from '../cosmetics/FramesProvider.tsx';
import { isArtFrame, type FrameId } from '../services/frames.ts';
import { PassFrame } from './PassArt.tsx';

/** DAMEO Pass frames are 'f-…'; shop frames are 'dameo', 'champion' and the art slugs */
const isPassFrame = (f: string | null | undefined): f is string => !!f && f.startsWith('f-');

function hueOf(seed: string): number {
  const h = Number(seed.split(':')[0]);
  if (Number.isFinite(h)) return Math.abs(h) % 360;
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return n;
}

export const isPhoto = (seed?: string) => !!seed && /^(https:\/\/|blob:)/.test(seed);

interface Props {
  name: string;
  /** "hue:n" colour seed, or a photo URL (own storage / Telegram userpic) */
  seed?: string;
  size?: number;
  online?: boolean;
  ring?: 'gold' | 'silver' | 'bronze';
  className?: string;
  /** the player's id: shows their avatar frame, if they wear one */
  userId?: string | null;
  /** explicit frame (frame picker previews) — overrides the looked-up one */
  frame?: FrameId | null;
}

export function Avatar({ name, seed, size = 40, online, ring, className = '', userId, frame }: Props) {
  const [broken, setBroken] = useState(false);
  const frames = useFrames();
  const fr = frame !== undefined ? frame : (frames?.frameOf(userId) ?? null);
  const photo = isPhoto(seed) && !broken;
  const hue = hueOf(photo ? name : (seed ?? name));
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  if (isPassFrame(fr)) {
    // one frame only: the Pass frame art sits around a slightly smaller avatar, in the same box
    const inner = Math.round(size * 0.875);
    return (
      <span className={`avatar-passframe ${className}`} style={{ width: size, height: size }} aria-hidden="true">
        <PassFrame id={fr} size={inner}>
          <Avatar name={name} seed={seed} size={inner} frame={null} />
        </PassFrame>
      </span>
    );
  }
  return (
    <span
      className={`avatar ${photo ? 'avatar-photo' : ''} ${ring && !fr ? `avatar-${ring}` : ''} ${fr ? 'avatar-framed' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ['--h' as string]: hue }}
      aria-hidden="true"
    >
      {fr && (isArtFrame(fr) ? <span className={`av-frame-art af-${fr} ${size >= 48 ? 'af-live' : ''}`} /> : <span className={`av-frame av-frame-${fr}`} />)}
      {fr === 'champion' && <ChampionCrown size={size} />}
      {fr === 'champion' && size >= 48 && (
        <span className="av-champ-fx" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      )}
      {photo ? <img src={seed} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span className="avatar-face">{initial}</span>}
      {online !== undefined && <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} />}
    </span>
  );
}

export const PlayerAvatar = ({ p, size, online, ring }: { p: Pick<Player, 'username' | 'avatar'> & { id?: string }; size?: number; online?: boolean; ring?: Props['ring'] }) => (
  <Avatar name={p.username} seed={p.avatar} size={size} online={online} ring={ring} userId={p.id} />
);

/** The #1's crown: gold with a jewelled band and pearl tips. */
function ChampionCrown({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="av-crown" viewBox="0 0 32 22" style={{ width: Math.max(14, Math.round(size * 0.46)) }} aria-hidden="true">
      <defs>
        <linearGradient id={`cg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6cf" />
          <stop offset="0.45" stopColor="#ffd34d" />
          <stop offset="1" stopColor="#c07d0a" />
        </linearGradient>
        <linearGradient id={`cb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe48a" />
          <stop offset="1" stopColor="#9c6206" />
        </linearGradient>
      </defs>
      <path d="M3 17 L2 6 L9.5 11 L16 2.5 L22.5 11 L30 6 L29 17 Z" fill={`url(#cg${id})`} stroke="#7a4a00" strokeWidth="0.9" strokeLinejoin="round" />
      <rect x="2.6" y="16" width="26.8" height="4.4" rx="1.3" fill={`url(#cb${id})`} stroke="#7a4a00" strokeWidth="0.8" />
      <circle cx="2" cy="5.4" r="1.7" fill="#fffaf0" stroke="#b98a2a" strokeWidth="0.5" />
      <circle cx="16" cy="2" r="1.9" fill="#fffaf0" stroke="#b98a2a" strokeWidth="0.5" />
      <circle cx="30" cy="5.4" r="1.7" fill="#fffaf0" stroke="#b98a2a" strokeWidth="0.5" />
      <circle cx="9" cy="18.2" r="1.25" fill="#2f7bff" stroke="#0c2f80" strokeWidth="0.4" />
      <circle cx="16" cy="18.2" r="1.55" fill="#ff2d55" stroke="#7a0020" strokeWidth="0.4" />
      <circle cx="23" cy="18.2" r="1.25" fill="#2fd27a" stroke="#0b5a2e" strokeWidth="0.4" />
      <path d="M16 8.5 l1.6 2.6 -1.6 2.6 -1.6 -2.6 z" fill="#ff2d55" stroke="#7a0020" strokeWidth="0.4" />
      <path d="M5 8 L6 15.5 M27 8 L26 15.5" stroke="#fff6cf" strokeWidth="0.7" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** Emblems on the highest badges (from Level 40 the badge carries one; Level 100 wears the crown). */
const TIER_ICON: Record<number, IconType> = { 9: LuShield, 10: LuStar, 11: LuFlame, 12: LuSparkles, 13: LuGem, 14: LuSun, 15: LuCrown };

/** "Lv 12" badge; it grows richer with the level: blue → violet → pink → gold → emerald → ruby → diamond → legend → … → MAX. */
export function LevelBadge({ rating, label }: { rating: number; label: (n: number) => string }) {
  const { level } = levelOf(rating);
  const tier = levelTier(level);
  const Icon = TIER_ICON[tier];
  return (
    <span className={`level-badge lv-${level} lt-${tier} ${tier >= 8 ? 'lb-elite' : ''}`} aria-label={label(level)} title={label(level)}>
      {Icon && <Icon className="lb-ico" aria-hidden="true" />}
      <span className="lb-lv">Lv </span>
      <span className="lb-n">{level}</span>
    </span>
  );
}
