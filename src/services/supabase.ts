/**
 * Minimal Supabase client (Auth + PostgREST + Realtime) using only fetch and WebSocket.
 * It talks to the standard Supabase HTTP APIs, so it can be swapped for
 * `@supabase/supabase-js` without touching the rest of the app.
 * Uses the public anon key only; every table is protected by Row Level Security.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL, backendConfigured } from './config.ts';
import { readJSON, removeKey, writeJSON } from './localStore.ts';

export interface SbUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}
export interface SbSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  user: SbUser;
}

export class SbError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = 'dameo.sb.session';
let session: SbSession | null = backendConfigured ? readJSON<SbSession | null>(SESSION_KEY, null) : null;
const authListeners = new Set<(s: SbSession | null) => void>();

function setSession(s: SbSession | null) {
  session = s;
  if (s) writeJSON(SESSION_KEY, s);
  else removeKey(SESSION_KEY);
  authListeners.forEach((fn) => fn(s));
}

export const getSession = () => session;
/** Adopt a session issued by our own Edge Function (Telegram login). */
export function adoptSession(data: any) {
  setSession(normalizeSession(data));
}
export function onAuthChange(fn: (s: SbSession | null) => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function normalizeSession(data: any): SbSession {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user: data.user,
  };
}

async function parseError(res: Response): Promise<SbError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not json */
  }
  const msg = body?.msg || body?.message || body?.error_description || body?.error || res.statusText;
  return new SbError(String(msg), res.status, body?.error_code || body?.code);
}

let refreshing: Promise<void> | null = null;
async function ensureFreshToken(): Promise<void> {
  if (!session) return;
  if (session.expires_at - 30 > Date.now() / 1000) return;
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session!.refresh_token }),
      });
      if (!res.ok) {
        setSession(null); // refresh token rejected: signed out
        throw await parseError(res);
      }
      setSession(normalizeSession(await res.json()));
    })().finally(() => {
      refreshing = null;
    });
  }
  await refreshing;
}

/* ----------------------------- Auth ----------------------------- */

export const auth = {
  async signUp(email: string, password: string, username: string): Promise<{ needsConfirmation: boolean }> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { username } }),
    });
    if (!res.ok) throw await parseError(res);
    const data = await res.json();
    if (data.access_token) {
      setSession(normalizeSession(data));
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  },
  async signIn(email: string, password: string): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await parseError(res);
    setSession(normalizeSession(await res.json()));
  },
  async signOut(): Promise<void> {
    const s = session;
    setSession(null);
    if (!s) return;
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch {
      /* local sign-out already happened */
    }
  },
};

/* ----------------------------- REST ----------------------------- */

async function request<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  await ensureFreshToken();
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface QueryOpts {
  select?: string;
  /** PostgREST filters, e.g. { status: 'eq.active', rating: 'gte.1200' } */
  filter?: Record<string, string>;
  order?: string;
  limit?: number;
  offset?: number;
}

function qs(o: QueryOpts): string {
  const p = new URLSearchParams();
  p.set('select', o.select ?? '*');
  for (const [k, v] of Object.entries(o.filter ?? {})) p.set(k, v);
  if (o.order) p.set('order', o.order);
  if (o.limit != null) p.set('limit', String(o.limit));
  if (o.offset != null) p.set('offset', String(o.offset));
  return p.toString();
}

export const db = {
  select<T>(table: string, o: QueryOpts = {}): Promise<T[]> {
    return request<T[]>(`/rest/v1/${table}?${qs(o)}`);
  },
  /** returns rows plus the exact total (for pagination) */
  async selectWithCount<T>(table: string, o: QueryOpts = {}): Promise<{ rows: T[]; total: number }> {
    await ensureFreshToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(o)}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) throw await parseError(res);
    const range = res.headers.get('content-range') ?? '';
    const total = Number(range.split('/')[1]);
    const rows = (await res.json()) as T[];
    return { rows, total: Number.isFinite(total) ? total : rows.length };
  },
  insert<T>(table: string, row: object): Promise<T[]> {
    return request<T[]>(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' });
  },
  update<T>(table: string, filter: Record<string, string>, patch: object): Promise<T[]> {
    return request<T[]>(`/rest/v1/${table}?${new URLSearchParams(filter)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      prefer: 'return=representation',
    });
  },
  delete(table: string, filter: Record<string, string>): Promise<void> {
    return request<void>(`/rest/v1/${table}?${new URLSearchParams(filter)}`, { method: 'DELETE' });
  },
  rpc<T>(fn: string, args: object = {}): Promise<T> {
    return request<T>(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  },
  async invokeFunction<T>(name: string, body: object): Promise<T> {
    return request<T>(`/functions/v1/${name}`, { method: 'POST', body: JSON.stringify(body) });
  },
};

/* ---------------------------- Storage ---------------------------- */

export async function storageUpload(bucket: string, path: string, blob: Blob): Promise<void> {
  await ensureFreshToken();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
      'Content-Type': blob.type,
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body: blob,
  });
  if (!res.ok) throw await parseError(res);
}

/* --------------------------- Realtime --------------------------- */

export interface ChangeEvent<T = any> {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: T;
  old: Partial<T>;
}
export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface Subscription {
  close(): void;
}

type Spec = { table: string; event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'; filter?: string };
interface Channel {
  topic: string;
  specs: Spec[];
  onChange: (e: ChangeEvent) => void;
  onStatus?: (s: ConnectionState) => void;
  joinRef: string | null;
  /** Broadcast channel (migration 0035): listeners by event; one channel per topic, shared by all its listeners */
  bc?: Set<{ onEvent: (event: string, payload: any) => void; onStatus?: (s: ConnectionState) => void }>;
  state?: ConnectionState;
}

/**
 * ONE shared WebSocket for the whole app (Supabase counts concurrent connections per socket).
 * Every subscribeChanges() call is a Phoenix channel multiplexed over that socket.
 * Reconnects with exponential backoff and re-joins every channel; `onStatus('open')` fires after
 * each (re)join so callers can refetch anything missed while offline.
 */
const hub = {
  ws: null as WebSocket | null,
  channels: new Map<string, Channel>(),
  ref: 0,
  attempt: 0,
  hb: undefined as any,
  retry: undefined as any,
  idle: undefined as any,
};

function hubSend(topic: string, event: string, payload: unknown, joinRef?: string | null): string {
  const ref = String(++hub.ref);
  if (hub.ws?.readyState === 1) hub.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: joinRef ?? undefined }));
  return ref;
}

function setState(ch: Channel, st: ConnectionState) {
  ch.state = st;
  ch.onStatus?.(st);
  ch.bc?.forEach((l) => l.onStatus?.(st));
}

function joinChannel(ch: Channel) {
  setState(ch, 'connecting');
  ch.joinRef = hubSend(ch.topic, 'phx_join', {
    config: {
      broadcast: { self: false },
      presence: { key: '' },
      postgres_changes: ch.bc ? [] : ch.specs.map((s) => ({ event: s.event ?? '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) })),
      ...(ch.bc ? { private: false } : {}),
    },
    access_token: session?.access_token ?? SUPABASE_ANON_KEY,
  });
}

function hubConnect() {
  if (hub.ws || hub.channels.size === 0) return;
  hub.channels.forEach((c) => setState(c, 'connecting'));
  const url = SUPABASE_URL.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
  const ws = new WebSocket(url);
  hub.ws = ws;
  ws.onopen = () => {
    hub.channels.forEach(joinChannel);
    clearInterval(hub.hb);
    hub.hb = setInterval(() => hubSend('phoenix', 'heartbeat', {}), 25_000);
  };
  ws.onmessage = (m) => {
    let msg: any;
    try {
      msg = JSON.parse(m.data);
    } catch {
      return;
    }
    const ch = hub.channels.get(msg.topic);
    if (!ch) return;
    if (msg.event === 'phx_reply' && msg.ref === ch.joinRef) {
      if (msg.payload?.status === 'ok') {
        hub.attempt = 0;
        setState(ch, 'open');
      } else setState(ch, 'closed');
    } else if (msg.event === 'postgres_changes') {
      const d = msg.payload?.data;
      if (d) ch.onChange({ type: d.type, table: d.table, record: d.record, old: d.old_record ?? {} });
    } else if (msg.event === 'broadcast' && ch.bc) {
      const ev = String(msg.payload?.event ?? '');
      const data = msg.payload?.payload ?? {};
      ch.bc.forEach((l) => {
        try {
          l.onEvent(ev, data);
        } catch (e) {
          console.warn('[DAMEO] broadcast handler', e);
        }
      });
    } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
      setState(ch, 'closed');
    }
  };
  const down = () => {
    if (hub.ws !== ws) return;
    clearInterval(hub.hb);
    hub.ws = null;
    if (hub.channels.size === 0) return;
    hub.channels.forEach((c) => setState(c, 'closed'));
    const wait = Math.min(30_000, 1000 * 2 ** hub.attempt++);
    clearTimeout(hub.retry);
    hub.retry = setTimeout(hubConnect, wait);
  };
  ws.onclose = down;
  ws.onerror = () => ws.close();
}

function hubRestart() {
  clearTimeout(hub.retry);
  const old = hub.ws;
  hub.ws = null;
  clearInterval(hub.hb);
  try {
    old?.close();
  } catch {
    /* noop */
  }
  hub.attempt = 0;
  hubConnect();
}

if (backendConfigured && typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (hub.ws?.readyState !== 1) hubRestart();
  });
  // a new login/logout changes what RLS lets each channel see → re-join with the new token
  onAuthChange(() => {
    if (hub.channels.size > 0) hubRestart();
  });
}

export function subscribeChanges(topicName: string, specs: Spec[], onChange: (e: ChangeEvent) => void, onStatus?: (s: ConnectionState) => void): Subscription {
  if (!backendConfigured) return { close() {} };
  let topic = `realtime:${topicName}`;
  let n = 1;
  while (hub.channels.has(topic)) topic = `realtime:${topicName}#${++n}`;
  const ch: Channel = { topic, specs, onChange, onStatus, joinRef: null };
  hub.channels.set(topic, ch);
  clearTimeout(hub.idle);
  if (hub.ws?.readyState === 1) joinChannel(ch);
  else hubConnect();
  return {
    close() {
      if (!hub.channels.delete(topic)) return;
      hubSend(topic, 'phx_leave', {}, ch.joinRef);
      if (hub.channels.size === 0) {
        // keep the socket briefly in case the next page subscribes again
        hub.idle = setTimeout(() => {
          if (hub.channels.size === 0) {
            clearInterval(hub.hb);
            const w = hub.ws;
            hub.ws = null;
            w?.close();
          }
        }, 5000);
      }
    },
  };
}


/* --------------------------- Realtime Broadcast (migration 0035) --------------------------- */

/**
 * Listen to a Broadcast topic ('m:<match>', 'lb', 'live', 'lc:<match>' or the private 'u:<…>' topic).
 * All listeners of one topic share one channel on the shared socket.
 */
export function subscribeBroadcast(topicName: string, onEvent: (event: string, payload: any) => void, onStatus?: (s: ConnectionState) => void): Subscription {
  if (!backendConfigured) return { close() {} };
  const topic = `realtime:${topicName}`;
  let ch = hub.channels.get(topic);
  const listener = { onEvent, onStatus };
  if (!ch || !ch.bc) {
    ch = { topic, specs: [], onChange: () => {}, joinRef: null, bc: new Set() };
    hub.channels.set(topic, ch);
    ch.bc!.add(listener);
    clearTimeout(hub.idle);
    if (hub.ws?.readyState === 1) joinChannel(ch);
    else hubConnect();
  } else {
    ch.bc.add(listener);
    if (ch.state) onStatus?.(ch.state);
  }
  const chan = ch;
  return {
    close() {
      chan.bc!.delete(listener);
      if (chan.bc!.size > 0 || hub.channels.get(topic) !== chan) return;
      hub.channels.delete(topic);
      hubSend(topic, 'phx_leave', {}, chan.joinRef);
      if (hub.channels.size === 0) {
        hub.idle = setTimeout(() => {
          if (hub.channels.size === 0) {
            clearInterval(hub.hb);
            const w = hub.ws;
            hub.ws = null;
            w?.close();
          }
        }, 5000);
      }
    },
  };
}

export type RtMode = 'changes' | 'broadcast';
let rtModeNow: RtMode = 'changes';
let rtModeReady: Promise<RtMode> | null = null;
const rtModeListeners = new Set<(m: RtMode) => void>();
async function fetchRtMode(): Promise<RtMode> {
  try {
    const m = await Promise.race([db.rpc<string>('rt_mode'), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return m === 'broadcast' ? 'broadcast' : 'changes';
  } catch {
    return rtModeNow; // keep what we have (the old path by default)
  }
}
/** Which live-update path the server wants (admin switch, migration 0035). Re-checked every 5 min and on wake. */
export function rtMode(): Promise<RtMode> {
  if (!rtModeReady) {
    rtModeReady = fetchRtMode().then((m) => (rtModeNow = m));
    if (typeof window !== 'undefined') {
      const recheck = async () => {
        const m = await fetchRtMode();
        if (m !== rtModeNow) {
          rtModeNow = m;
          rtModeListeners.forEach((f) => f(m));
        }
      };
      setInterval(() => document.visibilityState === 'visible' && void recheck(), 5 * 60_000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void recheck());
    }
  }
  return rtModeReady;
}
export const currentRtMode = () => rtModeNow;

let myTopicP: { uid: string; p: Promise<string | null> } | null = null;
/** My private Broadcast topic (unguessable; only the server and I know it). */
export function myRtTopic(): Promise<string | null> {
  const uid = session?.user?.id ?? '';
  if (!uid) return Promise.resolve(null);
  if (!myTopicP || myTopicP.uid !== uid) myTopicP = { uid, p: db.rpc<string | null>('my_rt_topic').catch(() => null) };
  return myTopicP.p;
}

/**
 * One live subscription that uses either the old path (postgres_changes) or Broadcast, as the server says,
 * and switches over by itself when the admin flips the switch. Callers keep the same callbacks.
 */
export function subscribeLive(o: { changes: () => Subscription; broadcast: () => Subscription | Promise<Subscription> }): Subscription {
  if (!backendConfigured) return { close() {} };
  let inner: Subscription | null = null;
  let closed = false;
  let using: RtMode | null = null;
  const open = async (m: RtMode) => {
    if (closed || m === using) return;
    inner?.close();
    inner = null;
    using = m;
    const sub = m === 'broadcast' ? await o.broadcast() : o.changes();
    if (closed || using !== m) sub.close();
    else inner = sub;
  };
  const onMode = (m: RtMode) => void open(m);
  rtModeListeners.add(onMode);
  void rtMode().then((m) => open(m));
  return {
    close() {
      closed = true;
      rtModeListeners.delete(onMode);
      inner?.close();
      inner = null;
    },
  };
}

/** Listen to my private topic (invites, challenges, pairing, wallet, notifications, friends, profile). */
export async function onMyTopic(onEvent: (event: string, payload: any) => void, onStatus?: (s: ConnectionState) => void): Promise<Subscription> {
  const t = await myRtTopic();
  if (!t) return { close() {} };
  return subscribeBroadcast(t, onEvent, onStatus);
}
