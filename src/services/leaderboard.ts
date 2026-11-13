import type { Player } from '../types/models.ts';
import { appActive } from './telegram.ts';
import { backendConfigured } from './config.ts';
import { DEMO_PLAYERS, isOnline } from './demoData.ts';
import { db, subscribeBroadcast, subscribeChanges, subscribeLive, type ConnectionState } from './supabase.ts';

export type RankedPlayer = Player & { rank: number };
export type Scope = 'all' | 'friends' | 'top100';

export interface LeaderboardQuery {
  scope: Scope;
  search: string;
  page: number; // 0-based
  pageSize: number;
}
export interface LeaderboardPage {
  rows: RankedPlayer[];
  total: number;
  updatedAt: number;
  source: 'demo' | 'live';
  /** the current player's row, if present */
  me?: RankedPlayer;
}

interface DbRow {
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
  rank: number;
}

export const fromRow = (r: Omit<DbRow, 'rank'> & { rank?: number }): Player => ({
  id: r.id,
  username: r.username,
  avatar: r.avatar,
  rating: r.rating,
  wins: r.wins,
  losses: r.losses,
  draws: r.draws,
  lastSeen: new Date(r.last_seen).getTime(),
  country: r.country ?? undefined,
  lastDelta: r.last_delta ?? undefined,
});

export function rankAll(players: Player[]): RankedPlayer[] {
  return [...players]
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.username.localeCompare(b.username))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

export interface LeaderboardContext {
  me: Player | null;
  friendIds: string[];
}

export async function fetchLeaderboard(q: LeaderboardQuery, ctx: LeaderboardContext): Promise<LeaderboardPage> {
  if (!backendConfigured) {
    const pool = ctx.me ? [...DEMO_PLAYERS, ctx.me] : DEMO_PLAYERS;
    let ranked = rankAll(pool);
    const me = ctx.me ? ranked.find((p) => p.id === ctx.me!.id) : undefined;
    if (q.scope === 'top100') ranked = ranked.slice(0, 100);
    if (q.scope === 'friends') ranked = ranked.filter((p) => ctx.friendIds.includes(p.id) || p.id === ctx.me?.id);
    const s = q.search.trim().toLowerCase();
    if (s) ranked = ranked.filter((p) => p.username.toLowerCase().includes(s));
    const start = q.page * q.pageSize;
    return { rows: ranked.slice(start, start + q.pageSize), total: ranked.length, updatedAt: Date.now(), source: 'demo', me };
  }
  const { rows, total } = await liveRows(q);
  let me: RankedPlayer | undefined;
  if (ctx.me) {
    const mine = await db.select<DbRow>('leaderboard', { filter: { id: `eq.${ctx.me.id}` }, limit: 1 });
    if (mine[0]) me = { ...fromRow(mine[0]), rank: mine[0].rank };
  }
  return { rows, total, updatedAt: Date.now(), source: 'live', me };
}

async function liveRows(q: LeaderboardQuery): Promise<{ rows: RankedPlayer[]; total: number }> {
  const limit = q.scope === 'top100' ? Math.max(0, Math.min(q.pageSize, 100 - q.page * q.pageSize)) : q.pageSize;
  const res = await db.rpc<Array<DbRow & { total_count: number }>>('leaderboard_page', {
    p_scope: q.scope,
    p_search: q.search.trim(),
    p_limit: limit,
    p_offset: q.page * q.pageSize,
  });
  return {
    rows: res.map((r) => ({ ...fromRow(r), rank: r.rank })),
    total: q.scope === 'top100' ? Math.min(100, res[0]?.total_count ?? 0) : (res[0]?.total_count ?? 0),
  };
}

/** Subscribe to rating changes; callback is debounced. Returns an unsubscribe function. */
export function subscribeLeaderboard(onUpdate: () => void, onStatus?: (s: ConnectionState) => void, relevant?: (r: { id: string; rating: number }) => boolean): () => void {
  if (!backendConfigured) return () => {};
  let t: any;
  let last = 0;
  // every player's presence heartbeat updates their profile row once a minute: refetch only when a
  // rating (or name/avatar) actually changed, and not more often than every 5 s
  const seen = new Map<string, string>();
  const soon = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      last = Date.now();
      onUpdate();
    }, Math.max(400, 5000 - (Date.now() - last)));
  };
  const status = (s: ConnectionState) => {
    onStatus?.(s);
    if (s === 'open') onUpdate(); // catch up after a reconnect
  };
  const sub = subscribeLive({
    changes: () =>
      subscribeChanges(
        'public:leaderboard',
        [{ table: 'profiles', event: 'UPDATE' }],
        (e) => {
          const r = e.record as { id: string; rating: number; wins?: number; losses?: number; draws?: number; username?: string; avatar?: string };
          const sig = `${r.rating}|${r.wins}|${r.losses}|${r.draws}|${r.username}|${r.avatar}`;
          const prev = seen.get(r.id);
          seen.set(r.id, sig);
          if (prev === sig) return;
          if (prev === undefined && relevant && !relevant(r)) return;
          soon();
        },
        status,
      ),
    // Broadcast: the server announces only real rating/name/avatar changes (never the presence heartbeat)
    broadcast: () => subscribeBroadcast('lb', (ev) => ev === 'lb' && soon(), status),
  });
  return () => {
    clearTimeout(t);
    sub.close();
  };
}

export async function onlineCount(): Promise<number> {
  if (!backendConfigured) return DEMO_PLAYERS.filter((p) => isOnline(p)).length;
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { total } = await db.selectWithCount('profiles', { select: 'id', filter: { last_seen: `gte.${since}` }, limit: 1 });
  return total;
}

export async function recentlyActive(limit = 6): Promise<Player[]> {
  if (!backendConfigured) return [...DEMO_PLAYERS].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
  const rows = await db.select<DbRow>('profiles', { order: 'last_seen.desc', limit });
  return rows.map(fromRow);
}

/** Heartbeat for online presence: updates only the caller's own last_seen via RPC. */
export function startPresence(): () => void {
  if (!backendConfigured) return () => {};
  const beat = () => {
    if (appActive() && navigator.onLine) db.rpc('touch_presence').catch(() => {});
  };
  beat();
  const id = setInterval(beat, 60_000);
  document.addEventListener('visibilitychange', beat);
  window.addEventListener('online', beat);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', beat);
    window.removeEventListener('online', beat);
  };
}
