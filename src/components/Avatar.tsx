import { useState } from 'react';
import type { Player } from '../types/models.ts';
import { levelOf } from '../services/levels.ts';
import { useFrames } from '../cosmetics/FramesProvider.tsx';
import { isArtFrame, type FrameId } from '../services/frames.ts';

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
  return (
    <span
      className={`avatar ${photo ? 'avatar-photo' : ''} ${ring && !fr ? `avatar-${ring}` : ''} ${fr ? 'avatar-framed' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ['--h' as string]: hue }}
      aria-hidden="true"
    >
      {fr && (isArtFrame(fr) ? <span className={`av-frame-art af-${fr} ${size >= 48 ? 'af-live' : ''}`} /> : <span className={`av-frame av-frame-${fr}`} />)}
      {fr === 'champion' && (
        <svg className="av-crown" viewBox="0 0 24 16" style={{ width: Math.max(12, Math.round(size * 0.4)) }} aria-hidden="true">
          <path d="M2 14 L1 3 L7 8 L12 1 L17 8 L23 3 L22 14 Z" />
          <rect x="2" y="13.5" width="20" height="2.5" rx="1" />
        </svg>
      )}
      {photo ? <img src={seed} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span className="avatar-face">{initial}</span>}
      {online !== undefined && <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} />}
    </span>
  );
}

export const PlayerAvatar = ({ p, size, online, ring }: { p: Pick<Player, 'username' | 'avatar'> & { id?: string }; size?: number; online?: boolean; ring?: Props['ring'] }) => (
  <Avatar name={p.username} seed={p.avatar} size={size} online={online} ring={ring} userId={p.id} />
);

/** Small "Lv 3" badge; colour climbs from blue to gold with the level. */
export function LevelBadge({ rating, label }: { rating: number; label: (n: number) => string }) {
  const { level } = levelOf(rating);
  return <span className={`level-badge lv-${level}`}>{label(level)}</span>;
}
