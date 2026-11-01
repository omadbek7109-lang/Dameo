/**
 * Online play (requires the Supabase backend). All writes that matter go
 * through server-side functions:
 *   - rooms / matchmaking:  SQL RPCs (create_room, join_room, quick_match, cancel_quick_match)
 *   - moves / resign:       Edge Function `match-action`, which replays the game with the same
 *                           engine, rejects illegal moves, and applies ratings exactly once.
 * The browser never inserts moves directly and never submits a rating or a result.
 */
import { db, subscribeChanges, type ConnectionState } from './supabase.ts';

export type OnlineStatus = 'waiting' | 'active' | 'finished' | 'aborted';
export interface OnlineMatch {
  id: string;
  code: string | null;
  whiteId: string;
  blackId: string | null;
  whiteName: string;
  blackName: string | null;
  whiteRating: number;
  blackRating: number | null;
  status: OnlineStatus;
  result: 'white' | 'black' | 'draw' | null;
  reason: string | null;
  rated: boolean;
  vsBot: boolean;
  botLevel: 'easy' | 'medium' | 'hard' | null;
  /** rating change for the caller after finalisation, if any */
  ratingDelta?: number | null;
}
export interface OnlineMove {
  ply: number;
  from: number;
  path: number[];
}

interface MatchRow {
  id: string;
  code: string | null;
  white_id: string;
  black_id: string | null;
  white_name: string;
  black_name: string | null;
  white_rating: number;
  black_rating: number | null;
  status: OnlineStatus;
  result: OnlineMatch['result'];
  result_reason: string | null;
  rated: boolean;
  vs_bot?: boolean;
  bot_level?: 'easy' | 'medium' | 'hard' | null;
}

const mapMatch = (r: MatchRow): OnlineMatch => ({
  id: r.id,
  code: r.code,
  whiteId: r.white_id,
  blackId: r.black_id,
  whiteName: r.white_name,
  blackName: r.black_name,
  whiteRating: r.white_rating,
  blackRating: r.black_rating,
  status: r.status,
  result: r.result,
  reason: r.result_reason,
  rated: r.rated,
  vsBot: Boolean(r.vs_bot),
  botLevel: r.bot_level ?? null,
});

export const createRoom = () => db.rpc<{ match_id: string; code: string }>('create_room');
export const joinRoom = (code: string) => db.rpc<{ match_id: string }>('join_room', { p_code: code.trim().toUpperCase() });
/** match_id when paired; otherwise the server-side search start + server clock (for a server-anchored countdown). */
export const quickMatch = () => db.rpc<{ match_id: string | null; searching_since?: string; server_now?: string }>('quick_match');
export const cancelQuickMatch = () => db.rpc('cancel_quick_match');
/** How many rated bot games are left today (5 per day; later bot games are unrated). */
export const botGamesLeft = () => db.rpc<number>('bot_games_left');
/** Rated game against the server-side bot ('random' = server picks the level). */
export const startBotMatch = (level: 'easy' | 'medium' | 'hard' | 'random') => db.rpc<{ match_id: string; level: string; rated: boolean; rated_left: number }>('start_bot_match', { p_level: level });

export async function getMatch(id: string): Promise<OnlineMatch | null> {
  const rows = await db.select<MatchRow>('match_view', { filter: { id: `eq.${id}` }, limit: 1 });
  return rows[0] ? mapMatch(rows[0]) : null;
}

export async function getMoves(id: string): Promise<OnlineMove[]> {
  const rows = await db.select<{ ply: number; from_sq: number; path: number[] }>('match_moves', {
    filter: { match_id: `eq.${id}` },
    order: 'ply.asc',
  });
  return rows.map((r) => ({ ply: r.ply, from: r.from_sq, path: r.path }));
}

export const submitMove = (matchId: string, from: number, path: number[]) =>
  db.invokeFunction<{ ok: boolean; error?: string; bot?: OnlineMove | null }>('match-action', { action: 'move', match_id: matchId, from, path });
export const resignOnline = (matchId: string) => db.invokeFunction<{ ok: boolean }>('match-action', { action: 'resign', match_id: matchId });

export function watchMatch(
  matchId: string,
  h: { onMove: (m: OnlineMove) => void; onMatch: (m: OnlineMatch) => void; onStatus: (s: ConnectionState) => void },
): () => void {
  const sub = subscribeChanges(
    `public:match:${matchId}`,
    [
      { table: 'match_moves', event: 'INSERT', filter: `match_id=eq.${matchId}` },
      { table: 'matches', event: 'UPDATE', filter: `id=eq.${matchId}` },
    ],
    async (e) => {
      if (e.table === 'match_moves') h.onMove({ ply: e.record.ply, from: e.record.from_sq, path: e.record.path });
      else {
        const fresh = await getMatch(matchId).catch(() => null); // view includes names/ratings
        if (fresh) h.onMatch(fresh);
      }
    },
    h.onStatus,
  );
  return () => sub.close();
}

/** Fires when the matchmaker pairs the current user (a `matches` row appears for them). */
export function watchPairing(userId: string, onPaired: (matchId: string) => void): () => void {
  const sub = subscribeChanges(
    `public:pairing:${userId}`,
    [
      { table: 'matches', event: 'INSERT', filter: `white_id=eq.${userId}` },
      { table: 'matches', event: 'INSERT', filter: `black_id=eq.${userId}` },
      { table: 'matches', event: 'UPDATE', filter: `black_id=eq.${userId}` },
    ],
    (e) => {
      if (e.record?.status === 'active') onPaired(e.record.id);
    },
  );
  return () => sub.close();
}

/* ------------------------------ lobby & challenges ------------------------------ */

export interface LobbyPlayer {
  id: string;
  username: string;
  avatar: string;
  rating: number;
  waiting_seconds: number;
}
export interface IncomingChallenge {
  id: string;
  from_id: string;
  username: string;
  avatar: string;
  rating: number;
  created_at: string;
}
/** Players searching for a game right now (pinging quick_match within the last 15 s). */
export const lobby = () => db.rpc<LobbyPlayer[]>('lobby');
export const lobbyStats = () => db.rpc<{ online: number; searching: number }>('lobby_stats');
export const sendChallenge = (to: string) => db.rpc<{ challenge_id: string }>('send_challenge', { p_to: to });
export const cancelChallenge = (id: string) => db.rpc('cancel_challenge', { p_id: id });
export const respondChallenge = (id: string, accept: boolean) => db.rpc<{ match_id: string | null }>('respond_challenge', { p_id: id, p_accept: accept });
export const incomingChallenges = () => db.rpc<IncomingChallenge[]>('incoming_challenges');
/** A challenge expires 60 s after it is sent (enforced by the server). */
export const CHALLENGE_TTL_MS = 60_000;

/** Challenges I sent: fires on status changes (accepted / declined / cancelled). */
export function watchSentChallenges(userId: string, cb: (row: { id: string; status: string; match_id: string | null }) => void): () => void {
  const sub = subscribeChanges(`public:challenges-from:${userId}`, [{ table: 'challenges', event: 'UPDATE', filter: `from_id=eq.${userId}` }], (e) => cb(e.record));
  return () => sub.close();
}
/** Challenges addressed to me: fires when someone challenges me (or a challenge to me changes). */
export function watchIncomingChallenges(userId: string, cb: () => void): () => void {
  const sub = subscribeChanges(`public:challenges-to:${userId}`, [{ table: 'challenges', filter: `to_id=eq.${userId}` }], () => cb());
  return () => sub.close();
}
