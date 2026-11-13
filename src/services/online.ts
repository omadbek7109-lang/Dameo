/**
 * Online play (requires the Supabase backend). All writes that matter go
 * through server-side functions:
 *   - rooms / matchmaking:  SQL RPCs (create_room, join_room, quick_match, cancel_quick_match)
 *   - moves / resign:       Edge Function `match-action`, which replays the game with the same
 *                           engine, rejects illegal moves, and applies ratings exactly once.
 * The browser never inserts moves directly and never submits a rating or a result.
 */
import type { ClockState, TimeControl } from './clock.ts';
import { db, subscribeChanges, subscribeBroadcast, subscribeLive, onMyTopic, type ConnectionState } from './supabase.ts';

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
  /** player-vs-player clock (null for bot games and old untimed games) */
  clock: ClockState | null;
  /** set when the game was lost on time */
  timeoutKind: 'move' | 'clock' | null;
  /** server clock − local clock (ms), measured when this row was fetched */
  skewMs: number;
  /** visible to spectators */
  isPublic: boolean;
  /** virtual opponent (AI player with its own profile) — always shown with an "AI" badge */
  virtual: { id: string; avatar: string | null; level: VirtualLevel | null; style: string | null } | null;
  /** when the virtual opponent's planned move is due (local clock ms), null when none is pending */
  botDueAt: number | null;
  /** the virtual opponent's answer to a rematch offer ('declined' or the new match id) */
  virtualRematch: string | null;
  /** moves played, as counted by the server */
  moveCount: number;
}
export type VirtualLevel = 'beginner' | 'normal' | 'pro';
export interface VirtualPlayer {
  id: string;
  nickname: string;
  avatar: string;
  rating: number;
  level: VirtualLevel;
  style: string;
  wins: number;
  losses: number;
  draws: number;
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
  move_count?: number;
  time_control?: number | null;
  white_ms?: number | null;
  black_ms?: number | null;
  turn_started_at?: string | null;
  timeout_kind?: 'move' | 'clock' | null;
  server_now?: string | null;
  is_public?: boolean;
  virtual_id?: string | null;
  virtual_avatar?: string | null;
  virtual_level?: VirtualLevel | null;
  virtual_style?: string | null;
  bot_due_at?: string | null;
  virtual_rematch?: string | null;
}

/** server time → local time, given skew = server − local */
export const toLocalMs = (iso: string, skewMs: number) => Date.parse(iso) - skewMs;

const mapMatch = (r: MatchRow, receivedAt = Date.now()): OnlineMatch => {
  const server = r.server_now ? Date.parse(r.server_now) : NaN;
  const skewMs = Number.isFinite(server) ? server - receivedAt : 0;
  const clock: ClockState | null =
    r.time_control && r.turn_started_at && r.white_ms != null && r.black_ms != null
      ? { timeControl: r.time_control, whiteMs: r.white_ms, blackMs: r.black_ms, turnStartedAt: toLocalMs(r.turn_started_at, skewMs), moveCount: r.move_count ?? 0 }
      : null;
  return {
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
  clock,
  timeoutKind: r.timeout_kind ?? null,
  skewMs,
  isPublic: r.is_public ?? true,
  virtual: r.virtual_id ? { id: r.virtual_id, avatar: r.virtual_avatar ?? null, level: r.virtual_level ?? null, style: r.virtual_style ?? null } : null,
  botDueAt: r.bot_due_at ? toLocalMs(r.bot_due_at, skewMs) : null,
  virtualRematch: r.virtual_rematch ?? null,
  moveCount: r.move_count ?? 0,
  };
};

export const createRoom = () => db.rpc<{ match_id: string; code: string }>('create_room');
export const joinRoom = (code: string) => db.rpc<{ match_id: string }>('join_room', { p_code: code.trim().toUpperCase() });
/** match_id when paired; otherwise the server-side search start + server clock (for a server-anchored countdown). */
export const quickMatch = (timeControl: TimeControl) =>
  db.rpc<{ match_id: string | null; searching_since?: string; server_now?: string; time_control?: number }>('quick_match', { p_time: timeControl });
/** Ask the server to end the game because the side to move ran out of time (the server checks the clock itself). */
export const claimTimeout = (matchId: string) => db.rpc<{ ended: boolean; status: OnlineStatus }>('claim_timeout', { p_match: matchId });
export const cancelQuickMatch = () => db.rpc('cancel_quick_match');
/** Game against the server-side bot ('random' = server picks the level). Bot games never change the rating. */
export const startBotMatch = (level: 'easy' | 'medium' | 'hard' | 'random') => db.rpc<{ match_id: string; level: string; rated: boolean; rated_left: number }>('start_bot_match', { p_level: level });

export async function getMatch(id: string): Promise<OnlineMatch | null> {
  const t0 = Date.now();
  const rows = await db.select<MatchRow>('match_view', { filter: { id: `eq.${id}` }, limit: 1 });
  return rows[0] ? mapMatch(rows[0], (t0 + Date.now()) / 2) : null;
}

export async function getMoves(id: string): Promise<OnlineMove[]> {
  const rows = await db.select<{ ply: number; from_sq: number; path: number[] }>('match_moves', {
    filter: { match_id: `eq.${id}` },
    order: 'ply.asc',
  });
  return rows.map((r) => ({ ply: r.ply, from: r.from_sq, path: r.path }));
}

type ClockReply = { white_ms?: number; black_ms?: number; turn_started_at?: string } | null;
export const submitMove = (matchId: string, from: number, path: number[]) =>
  db.invokeFunction<{ ok: boolean; error?: string; bot?: OnlineMove | null; pending?: { due_at: string } | null; clock?: ClockReply }>('match-action', {
    action: 'move',
    match_id: matchId,
    from,
    path,
  });
/** Virtual opponent: commit its planned move (the server refuses before it is due and charges its clock itself). */
export const commitBotMove = (matchId: string) =>
  db.invokeFunction<{ ok: boolean; error?: string; due_at?: string; bot?: OnlineMove; clock?: ClockReply }>('match-action', { action: 'bot', match_id: matchId });
/** Asked ~20–35 s into a search with nobody found: a virtual opponent (null when they are switched off). */
export const virtualMatch = (timeControl: TimeControl) =>
  db.rpc<{ match_id: string | null; virtual?: VirtualPlayer | null; reason?: string }>('virtual_match', { p_time: timeControl });
export const virtualRematch = (matchId: string) => db.rpc<{ accepted: boolean; match_id?: string | null }>('virtual_rematch', { p_match: matchId });
export const virtualProfile = (id: string) =>
  db.rpc<(VirtualPlayer & { enabled: boolean; recent: Array<{ id: string; ended_at: string; result: 'white' | 'black' | 'draw'; time_control: number | null; opponent: string }> }) | null>('virtual_profile', { p_id: id });
export const resignOnline = (matchId: string) => db.invokeFunction<{ ok: boolean }>('match-action', { action: 'resign', match_id: matchId });

export function watchMatch(
  matchId: string,
  h: { onMove: (m: OnlineMove) => void; onMatch: (m: OnlineMatch) => void; onStatus: (s: ConnectionState) => void },
): () => void {
  const refetch = async () => {
    const fresh = await getMatch(matchId).catch(() => null); // view includes names/ratings
    if (fresh) h.onMatch(fresh);
  };
  const sub = subscribeLive({
    changes: () =>
      subscribeChanges(
        `public:match:${matchId}`,
        [
          { table: 'match_moves', event: 'INSERT', filter: `match_id=eq.${matchId}` },
          { table: 'matches', event: 'UPDATE', filter: `id=eq.${matchId}` },
        ],
        (e) => {
          if (e.table === 'match_moves') h.onMove({ ply: e.record.ply, from: e.record.from_sq, path: e.record.path });
          else void refetch();
        },
        h.onStatus,
      ),
    broadcast: () =>
      subscribeBroadcast(
        `m:${matchId}`,
        (ev, d) => {
          if (ev === 'move' && Number.isInteger(d?.ply)) h.onMove({ ply: d.ply, from: d.from, path: d.path });
          else if (ev === 'match') void refetch();
        },
        h.onStatus,
      ),
  });
  return () => sub.close();
}

/** Fires when the matchmaker pairs the current user (a `matches` row appears for them). */
export function watchPairing(userId: string, onPaired: (matchId: string) => void): () => void {
  const sub = subscribeLive({
    changes: () =>
      subscribeChanges(
        `public:pairing:${userId}`,
        [
          { table: 'matches', event: 'INSERT', filter: `white_id=eq.${userId}` },
          { table: 'matches', event: 'INSERT', filter: `black_id=eq.${userId}` },
          { table: 'matches', event: 'UPDATE', filter: `black_id=eq.${userId}` },
        ],
        (e) => {
          // real pairings only (a virtual / bot game is started by this client itself and handled there)
          if (e.record?.status === 'active' && !e.record?.vs_bot) onPaired(e.record.id);
        },
      ),
    // the server only announces real (non-bot) games that became active
    broadcast: async () => onMyTopic((ev, d) => ev === 'pair' && d?.status === 'active' && d?.id && onPaired(d.id)),
  });
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
  const sub = subscribeLive({
    changes: () => subscribeChanges(`public:challenges-from:${userId}`, [{ table: 'challenges', event: 'UPDATE', filter: `from_id=eq.${userId}` }], (e) => cb(e.record)),
    broadcast: async () => onMyTopic((ev, d) => ev === 'challenge_sent' && d?.id && cb({ id: d.id, status: d.status, match_id: d.match_id ?? null })),
  });
  return () => sub.close();
}
/** Challenges addressed to me: fires when someone challenges me (or a challenge to me changes). */
export function watchIncomingChallenges(userId: string, cb: () => void): () => void {
  const sub = subscribeLive({
    changes: () => subscribeChanges(`public:challenges-to:${userId}`, [{ table: 'challenges', filter: `to_id=eq.${userId}` }], () => cb()),
    broadcast: async () => onMyTopic((ev) => ev === 'challenge' && cb()),
  });
  return () => sub.close();
}
