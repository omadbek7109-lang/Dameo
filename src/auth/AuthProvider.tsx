import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { translate } from '../i18n/index.tsx';
import { readString } from '../services/localStore.ts';
import { backendConfigured } from '../services/config.ts';
import { DEMO_FRIEND_IDS } from '../services/demoData.ts';
import { startPresence } from '../services/leaderboard.ts';
import { LOCAL_ID, clearLocal, loadLocal, localAsPlayer, saveLocal, type LocalProfile } from '../services/localProfile.ts';
import { loadLiveProfile, updateLiveProfile } from '../services/profiles.ts';
import { ratingDelta, type Score } from '../services/rating.ts';
import { adoptSession, auth, db, getSession, onAuthChange, subscribeChanges, type SbSession } from '../services/supabase.ts';
import { inTelegram, rememberBotUsername, tg } from '../services/telegram.ts';
import type { AppNotification, MatchSummary, Player, RatingPoint } from '../types/models.ts';

export type AuthMode = 'demo' | 'live';

export interface DemoResultInput {
  opponent: string;
  opponentRating: number;
  result: MatchSummary['result'];
  mode: MatchSummary['mode'];
  moves: number;
  difficulty?: string;
  /** only 'demo-rated' games change the (local, demo) rating */
  rated: boolean;
}

interface AuthCtx {
  mode: AuthMode;
  ready: boolean;
  signedIn: boolean;
  /** set when automatic Telegram sign-in failed */
  tgError: string | null;
  me: Player | null;
  rank: number | null;
  matches: MatchSummary[];
  history: RatingPoint[];
  notifications: AppNotification[];
  friendIds: string[];
  local: LocalProfile | null;
  mutateLocal: (fn: (p: LocalProfile) => LocalProfile) => void;
  recordDemoResult: (r: DemoResultInput) => { delta: number; before: number; after: number };
  signOut: () => Promise<void>;
  updateProfile: (patch: { username?: string; avatar?: string }) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (kind: AppNotification['kind'], text: string, href?: string) => void;
  markAllRead: () => void;
  resetLocal: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);
const currentLang = () => (readString('dameo.lang') === 'en' ? 'en' : 'uz');
const uid = () => Math.random().toString(36).slice(2, 10);

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode: AuthMode = backendConfigured ? 'live' : 'demo';
  const [local, setLocal] = useState<LocalProfile | null>(() => (mode === 'demo' ? loadLocal() : null));
  const [session, setSession] = useState<SbSession | null>(getSession());
  const [liveMe, setLiveMe] = useState<Player | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [liveMatches, setLiveMatches] = useState<MatchSummary[]>([]);
  const [liveHistory, setLiveHistory] = useState<RatingPoint[]>([]);
  const [liveNotes, setLiveNotes] = useState<AppNotification[]>([]);
  const [ready, setReady] = useState(mode === 'demo');
  // Inside Telegram: sign in automatically with the Telegram account (verified by the telegram-auth function).
  const needsTg = (): boolean => {
    if (mode !== 'live' || !inTelegram || !tg) return false;
    const cur = getSession();
    const tgId = tg.initDataUnsafe?.user?.id;
    return !cur || (tgId != null && Number(cur.user?.user_metadata?.tg_id) !== tgId);
  };
  const [tgPending, setTgPending] = useState<boolean>(needsTg);
  const [tgError, setTgError] = useState<string | null>(null);
  useEffect(() => {
    if (!tgPending || !tg) return;
    let cancelled = false;
    db.invokeFunction<{ ok: boolean; error?: string; session?: any; bot_username?: string | null }>('telegram-auth', { initData: tg.initData })
      .then((r) => {
        if (cancelled) return;
        if (r?.ok && r.session) {
          rememberBotUsername(r.bot_username ?? null);
          adoptSession(r.session);
        } else setTgError(r?.error ?? 'unknown');
      })
      .catch((e: any) => !cancelled && setTgError(String(e?.message ?? e)))
      .finally(() => !cancelled && setTgPending(false));
    return () => {
      cancelled = true;
    };
  }, [tgPending]);
  const localRef = useRef(local);
  localRef.current = local;

  /* ---- live mode: session + profile ---- */
  useEffect(() => (mode === 'live' ? onAuthChange(setSession) : undefined), [mode]);

  const refresh = useCallback(async () => {
    if (mode !== 'live') return;
    const s = getSession();
    if (!s) {
      setLiveMe(null);
      setRank(null);
      setLiveMatches([]);
      setLiveHistory([]);
      setReady(true);
      return;
    }
    try {
      const b = await loadLiveProfile(s.user.id);
      if (b) {
        setLiveMe(b.player);
        setRank(b.rank);
        setLiveMatches(b.matches);
        setLiveHistory(b.history);
      }
    } catch {
      /* keep the previous snapshot; pages show their own error states */
    } finally {
      setReady(true);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'live') void refresh();
  }, [mode, session?.user.id, refresh]);

  useEffect(() => {
    if (mode !== 'live' || !session) return;
    const stop = startPresence();
    // own profile changes (e.g. rating applied by the server) update the UI without reload
    const sub = subscribeChanges('public:me', [{ table: 'profiles', event: 'UPDATE', filter: `id=eq.${session.user.id}` }], () => void refresh());
    const inv = subscribeChanges('public:invites', [{ table: 'game_invites', event: 'INSERT', filter: `to_id=eq.${session.user.id}` }], (e) => {
      notify('friend', translate(currentLang(), 'friends.inviteReceived'), `/play?mode=friends&join=${e.record.code}`);
    });
    return () => {
      stop();
      sub.close();
      inv.close();
    };
  }, [mode, session?.user.id, refresh]);

  /* ---- demo mode: persist local profile ---- */
  const mutateLocal = useCallback((fn: (p: LocalProfile) => LocalProfile) => {
    setLocal((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveLocal(next);
      return next;
    });
  }, []);

  const notify = useCallback(
    (kind: AppNotification['kind'], text: string, href?: string) => {
      const n: AppNotification = { id: uid(), ts: Date.now(), kind, text, read: false, href };
      if (mode === 'demo') mutateLocal((p) => ({ ...p, notifications: [n, ...p.notifications].slice(0, 30) }));
      else setLiveNotes((l) => [n, ...l].slice(0, 30));
    },
    [mode, mutateLocal],
  );

  const markAllRead = useCallback(() => {
    if (mode === 'demo') mutateLocal((p) => ({ ...p, notifications: p.notifications.map((n) => ({ ...n, read: true })) }));
    else setLiveNotes((l) => l.map((n) => ({ ...n, read: true })));
  }, [mode, mutateLocal]);

  const recordDemoResult = useCallback(
    (r: DemoResultInput) => {
      const cur = localRef.current;
      // Live mode: bot / practice / local games are not server-validated, so nothing is recorded.
      if (!cur) return { delta: 0, before: 0, after: 0 };
      const score: Score = r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0;
      const delta = r.rated ? ratingDelta(cur.rating, r.opponentRating, score, cur.ratedGames) : 0;
      const after = cur.rating + delta;
      const summary: MatchSummary = {
        id: uid(),
        ts: Date.now(),
        opponent: r.opponent,
        mode: r.mode,
        result: r.result,
        delta,
        rated: r.rated,
        moves: r.moves,
        difficulty: r.difficulty,
        demo: true,
      };
      mutateLocal((p) => ({
        ...p,
        rating: after,
        lastDelta: r.rated ? delta : p.lastDelta,
        ratedGames: p.ratedGames + (r.rated ? 1 : 0),
        wins: p.wins + (r.rated && r.result === 'win' ? 1 : 0),
        losses: p.losses + (r.rated && r.result === 'loss' ? 1 : 0),
        draws: p.draws + (r.rated && r.result === 'draw' ? 1 : 0),
        matches: [summary, ...p.matches].slice(0, 60),
        history: r.rated ? [...p.history, { ts: Date.now(), rating: after }].slice(-200) : p.history,
      }));
      return { delta, before: cur.rating, after };
    },
    [mutateLocal],
  );

  const signOut = useCallback(async () => {
    await auth.signOut();
  }, []);

  const updateProfile = useCallback(
    async (patch: { username?: string; avatar?: string }) => {
      if (mode === 'demo') {
        mutateLocal((p) => ({ ...p, ...(patch.username ? { username: patch.username } : {}), ...(patch.avatar ? { avatar: patch.avatar } : {}) }));
        return;
      }
      const s = getSession();
      if (!s) throw new Error('not signed in');
      await updateLiveProfile(s.user.id, patch);
      await refresh();
    },
    [mode, mutateLocal, refresh],
  );

  const resetLocal = useCallback(() => {
    clearLocal();
    setLocal(loadLocal());
  }, []);

  const value = useMemo<AuthCtx>(() => {
    const me = mode === 'demo' ? (local ? localAsPlayer(local) : null) : liveMe;
    return {
      mode,
      ready: ready && !tgPending,
      tgError,
      signedIn: mode === 'demo' ? true : Boolean(session),
      me,
      rank,
      matches: mode === 'demo' ? (local?.matches ?? []) : liveMatches,
      history: mode === 'demo' ? (local?.history ?? []) : liveHistory,
      notifications: mode === 'demo' ? (local?.notifications ?? []) : liveNotes,
      friendIds: mode === 'demo' ? [...DEMO_FRIEND_IDS, ...(local?.friends ?? [])] : [],
      local,
      mutateLocal,
      recordDemoResult,
      signOut,
      updateProfile,
      refresh,
      notify,
      markAllRead,
      resetLocal,
    };
  }, [mode, ready, tgPending, tgError, session, local, liveMe, rank, liveMatches, liveHistory, liveNotes, mutateLocal, recordDemoResult, signOut, updateProfile, refresh, notify, markAllRead, resetLocal]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
export { LOCAL_ID };
