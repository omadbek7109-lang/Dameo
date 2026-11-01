import { useState } from 'react';
import type { Player } from '../types/models.ts';
import { levelOf } from '../services/levels.ts';

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
}

export function Avatar({ name, seed, size = 40, online, ring, className = '' }: Props) {
  const [broken, setBroken] = useState(false);
  const photo = isPhoto(seed) && !broken;
  const hue = hueOf(photo ? name : (seed ?? name));
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={`avatar ${photo ? 'avatar-photo' : ''} ${ring ? `avatar-${ring}` : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ['--h' as string]: hue }}
      aria-hidden="true"
    >
      {photo ? <img src={seed} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span className="avatar-face">{initial}</span>}
      {online !== undefined && <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} />}
    </span>
  );
}

export const PlayerAvatar = ({ p, size, online, ring }: { p: Pick<Player, 'username' | 'avatar'>; size?: number; online?: boolean; ring?: Props['ring'] }) => (
  <Avatar name={p.username} seed={p.avatar} size={size} online={online} ring={ring} />
);

/** Small "Lv 3" badge; colour climbs from blue to gold with the level. */
export function LevelBadge({ rating, label }: { rating: number; label: (n: number) => string }) {
  const { level } = levelOf(rating);
  return <span className={`level-badge lv-${level}`}>{label(level)}</span>;
}
