import type { MatchSummary, Player, RatingPoint } from '../types/models.ts';
import { fromRow } from './leaderboard.ts';
import { db } from './supabase.ts';

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
