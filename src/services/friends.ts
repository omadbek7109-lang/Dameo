import type { FriendRequest, Player } from '../types/models.ts';
import { backendConfigured } from './config.ts';
import { DEMO_FRIEND_IDS, DEMO_INCOMING_IDS, DEMO_PLAYERS } from './demoData.ts';
import { fromRow } from './leaderboard.ts';
import { db } from './supabase.ts';

export interface Relations {
  friends: Player[];
  incoming: FriendRequest[];
  outgoing: Player[];
}

/* ------------------------------ demo ------------------------------ */
export interface DemoFriendState {
  friends: string[];
  outgoing: string[];
  handledIncoming: string[];
}

export function demoRelations(s: DemoFriendState): Relations {
  const byId = (id: string) => DEMO_PLAYERS.find((p) => p.id === id);
  const friendIds = [...DEMO_FRIEND_IDS, ...s.friends].filter((id, i, a) => a.indexOf(id) === i);
  return {
    friends: friendIds.map(byId).filter(Boolean) as Player[],
    incoming: DEMO_INCOMING_IDS.filter((id) => !s.handledIncoming.includes(id))
      .map(byId)
      .filter(Boolean)
      .map((p) => ({ id: p!.id, from: p!, demo: true })),
    outgoing: s.outgoing.map(byId).filter(Boolean) as Player[],
  };
}

export function demoSearch(query: string, exclude: Set<string>): Player[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return DEMO_PLAYERS.filter((p) => p.username.toLowerCase().includes(q) && !exclude.has(p.id)).slice(0, 12);
}

/* ------------------------------ live ------------------------------ */
interface RelRow {
  request_id: string;
  relation: 'friend' | 'incoming' | 'outgoing';
  id: string;
  username: string;
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  last_seen: string;
  country: string | null;
  last_delta: number | null;
}

export async function liveRelations(): Promise<Relations> {
  const rows = await db.rpc<RelRow[]>('list_relations');
  const out: Relations = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    const p = fromRow(r);
    if (r.relation === 'friend') out.friends.push(p);
    else if (r.relation === 'incoming') out.incoming.push({ id: r.request_id, from: p });
    else out.outgoing.push(p);
  }
  return out;
}

export async function liveSearch(query: string): Promise<Player[]> {
  if (query.trim().length < 2) return [];
  const rows = await db.rpc<Array<Omit<RelRow, 'request_id' | 'relation'>>>('search_players', { p_query: query.trim() });
  return rows.map(fromRow);
}

export const sendRequestLive = (userId: string) => db.rpc('send_friend_request', { p_user: userId });
export const respondRequestLive = (requestId: string, accept: boolean) => db.rpc('respond_friend_request', { p_request: requestId, p_accept: accept });
export const removeFriendLive = (userId: string) => db.rpc('remove_friend', { p_user: userId });
/** Returns the room code once the server has stored the invitation. */
export const inviteFriendLive = (userId: string) => db.rpc<{ code: string; match_id: string }>('invite_to_game', { p_friend: userId });

export { backendConfigured };
