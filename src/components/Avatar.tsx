import type { Player } from '../types/models.ts';

function hueOf(seed: string): number {
  const h = Number(seed.split(':')[0]);
  if (Number.isFinite(h)) return Math.abs(h) % 360;
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return n;
}

interface Props {
  name: string;
  seed?: string;
  size?: number;
  online?: boolean;
  ring?: 'gold' | 'silver' | 'bronze';
  className?: string;
}

export function Avatar({ name, seed, size = 40, online, ring, className = '' }: Props) {
  const hue = hueOf(seed ?? name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={`avatar ${ring ? `avatar-${ring}` : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ['--h' as string]: hue }}
      aria-hidden="true"
    >
      <span className="avatar-face">{initial}</span>
      {online !== undefined && <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} />}
    </span>
  );
}

export const PlayerAvatar = ({ p, size, online, ring }: { p: Pick<Player, 'username' | 'avatar'>; size?: number; online?: boolean; ring?: Props['ring'] }) => (
  <Avatar name={p.username} seed={p.avatar} size={size} online={online} ring={ring} />
);
