/**
 * Live spectating, spectator chat, players' match chat, draw / rematch offers, blocking (server: migration 0013).
 * Spectators only read; every write is a server function with rate limits and permission checks.
 */
import { db, subscribeChanges } from './supabase.ts';

export interface LiveGame {
  id: string;
  started_at: string;
  move_count: number;
  time_control: number | null;
  vs_bot: boolean;
  bot_level: string | null;
  rated: boolean;
  white_ms: number | null;
  black_ms: number | null;
  turn_started_at: string | null;
  white_name: string;
  white_avatar: string;
  white_rating: number;
  black_name: string | null;
  black_avatar: string | null;
  black_rating: number | null;
  viewers: number;
  moves: Array<[number, number[]]>;
}
export interface FeaturedGame {
  id: string;
  ended_at: string;
  move_count: number;
  result: 'white' | 'black' | 'draw';
  result_reason: string;
  time_control: number | null;
  white_name: string;
  white_avatar: string;
  white_rating: number;
  black_name: string;
  black_avatar: string;
  black_rating: number;
}
export interface ArchiveGame {
  id: string;
  ended_at: string;
  move_count: number;
  result: 'white' | 'black' | 'draw';
  result_reason: string;
  vs_bot: boolean;
  bot_level: string | null;
  time_control: number | null;
  rated: boolean;
  white_id: string;
  black_id: string | null;
  white_delta: number | null;
  black_delta: number | null;
  is_public: boolean;
  white_name: string;
  black_name: string;
}
export interface ChatMsg {
  id: number;
  user_id: string;
  username?: string;
  avatar?: string;
  kind: string;
  body: string;
  data?: Record<string, unknown>;
  created_at: string;
}
export const EMOTES = ['😂', '🔥', '👏', '😮', '😎', '🤝', '❤️'] as const;

export const liveStats = () => db.rpc<{ games: number; viewers: number }>('live_stats');
export const liveList = (offset = 0) => db.rpc<LiveGame[]>('live_list', { p_limit: 20, p_offset: offset });
export const featuredGames = () => db.rpc<FeaturedGame[]>('featured_games', { p_limit: 20 });
export const myGames = (before?: string) => db.rpc<ArchiveGame[]>('my_games', before ? { p_before: before, p_limit: 20 } : { p_limit: 20 });
export const livePing = (matchId: string) => db.rpc<{ viewers: number; status: string }>('live_ping', { p_match: matchId });
export const liveChatRecent = (matchId: string) => db.rpc<ChatMsg[]>('live_chat_recent', { p_match: matchId, p_limit: 50 });
export const liveChatSend = (matchId: string, kind: 'text' | 'emoji', body: string) => db.rpc('live_chat_send', { p_match: matchId, p_kind: kind, p_body: body });
export const matchChatSend = (matchId: string, kind: 'text' | 'emoji', body: string) => db.rpc('match_chat_send', { p_match: matchId, p_kind: kind, p_body: body });
export const matchChatHistory = (matchId: string) =>
  db.select<ChatMsg & { match_id: string }>('match_chat_messages', { filter: { match_id: `eq.${matchId}` }, order: 'id.asc', limit: 200 });
export const offerDraw = (matchId: string) => db.rpc('match_offer_draw', { p_match: matchId });
export const respondDraw = (matchId: string, accept: boolean) => db.rpc('match_respond_draw', { p_match: matchId, p_accept: accept });
export const offerRematch = (matchId: string) => db.rpc('match_offer_rematch', { p_match: matchId });
export const respondRematch = (matchId: string, accept: boolean) => db.rpc<{ match_id: string | null }>('match_respond_rematch', { p_match: matchId, p_accept: accept });
export const setMatchVisibility = (matchId: string, pub: boolean) => db.rpc('match_set_visibility', { p_match: matchId, p_public: pub });
export const blockUser = (userId: string, block: boolean) => db.rpc('block_user', { p_user: userId, p_block: block });
export const blockedUsers = () => db.rpc<Array<{ user_id: string; username: string; avatar: string; created_at: string }>>('blocked_users');
export const setHideGames = (userId: string, hide: boolean) => db.update('profiles', { id: `eq.${userId}` }, { hide_games: hide });
export const myHideGames = async (userId: string) => (await db.select<{ hide_games: boolean }>('profiles', { select: 'hide_games', filter: { id: `eq.${userId}` }, limit: 1 }))[0]?.hide_games ?? false;

/** new spectator messages (realtime; RLS keeps hidden ones and private games out) */
export function watchLiveChat(matchId: string, cb: (m: ChatMsg) => void): () => void {
  const sub = subscribeChanges(`public:livechat:${matchId}`, [{ table: 'live_chat_messages', event: 'INSERT', filter: `match_id=eq.${matchId}` }], (e) => cb(e.record));
  return () => sub.close();
}
/** new messages / offers in the players' chat (only the two players receive them) */
export function watchMatchChat(matchId: string, cb: (m: ChatMsg) => void): () => void {
  const sub = subscribeChanges(`public:matchchat:${matchId}`, [{ table: 'match_chat_messages', event: 'INSERT', filter: `match_id=eq.${matchId}` }], (e) => cb(e.record));
  return () => sub.close();
}

/** server error → short user message key */
export function chatErrorKey(msg: string): 'chat.err.slow' | 'chat.err.muted' | 'chat.err.dup' | 'chat.err.restricted' | 'chat.err.closed' | 'chat.err.generic' {
  if (/slow down|too many/.test(msg)) return 'chat.err.slow';
  if (/muted/.test(msg)) return 'chat.err.muted';
  if (/duplicate/.test(msg)) return 'chat.err.dup';
  if (/restricted/.test(msg)) return 'chat.err.restricted';
  if (/closed|cannot use/.test(msg)) return 'chat.err.closed';
  return 'chat.err.generic';
}
