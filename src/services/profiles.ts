import type { MatchSummary, Player, RatingPoint } from '../types/models.ts';
import { fromRow } from './leaderboard.ts';
import { SUPABASE_URL } from './config.ts';
import { db, storageUpload } from './supabase.ts';

export interface LiveProfileBundle {
  player: Player;
  rank: number | null;
  matches: MatchSummary[];
  history: RatingPoint[];
}

export async function loadLiveProfile(userId: string): Promise<LiveProfileBundle | null> {
  const [lb, matches, history] = await Promise.all([
    db.select<any>('leaderboard', { filter: { id: `eq.${userId}` }, limit: 1 }),
    db.select<any>('match_history', { filter: { user_id: `eq.${userId}` }, order: 'ended_at.desc', limit: 50 }),
    db.select<any>('rating_history', { select: 'created_at,rating', filter: { user_id: `eq.${userId}` }, order: 'created_at.asc', limit: 200 }),
  ]);
  if (!lb[0]) return null;
  return {
    player: fromRow(lb[0]),
    rank: lb[0].rank ?? null,
    matches: matches.map(
      (m: any): MatchSummary => ({
        id: m.match_id,
        ts: new Date(m.ended_at).getTime(),
        opponent: m.opponent_name,
        mode: 'online',
        result: m.result,
        delta: m.delta ?? 0,
        rated: Boolean(m.rated),
        moves: m.moves ?? 0,
      }),
    ),
    history: history.map((h: any) => ({ ts: new Date(h.created_at).getTime(), rating: h.rating })),
  };
}

export async function loadPublicProfile(userId: string): Promise<LiveProfileBundle | null> {
  // Public data only: rating history and matches are readable for rated games (see RLS).
  return loadLiveProfile(userId);
}

export async function updateLiveProfile(userId: string, patch: { username?: string; avatar?: string }): Promise<void> {
  await db.update('profiles', { id: `eq.${userId}` }, patch);
}

/** Shrink a picked image to a 256×256 square WebP (centre crop) before upload. */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error('not-image');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
    if (blob && blob.type === 'image/webp') return blob;
    const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!jpeg) throw new Error('encode');
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload to avatars/<uid>/avatar.<ext> (RLS lets each player write only their own folder). Returns the public URL. */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar.${ext}`;
  await storageUpload('avatars', path, blob);
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?v=${Date.now()}`;
}
