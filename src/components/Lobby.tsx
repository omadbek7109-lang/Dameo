import { useCallback, useEffect, useRef, useState } from 'react';
import { LuBot, LuCheck, LuClock, LuLoader, LuSend, LuSwords, LuUsers, LuX } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import {
  CHALLENGE_TTL_MS,
  cancelChallenge,
  cancelQuickMatch,
  incomingChallenges,
  lobby,
  lobbyStats,
  quickMatch,
  respondChallenge,
  sendChallenge,
  startBotMatch,
  watchIncomingChallenges,
  watchPairing,
  watchSentChallenges,
  type IncomingChallenge,
  type LobbyPlayer,
} from '../services/online.ts';
import { SbError } from '../services/supabase.ts';
import { haptic } from '../services/telegram.ts';
import { Avatar, LevelBadge } from './Avatar.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

export const SEARCH_WINDOW_S = 60;
const POLL_MS = 4000;

type Phase = 'idle' | 'searching' | 'timeout' | 'found';

/** Live matchmaking: 60 s search → offer bot or keep waiting; plus the lobby list with direct challenges. */
export function LiveQuickPanel() {
  const { t, num } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [left, setLeft] = useState(SEARCH_WINDOW_S);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [stats, setStats] = useState<{ online: number; searching: number } | null>(null);
  const [sent, setSent] = useState<{ id: string; to: LobbyPlayer; at: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const run = useRef(0); // invalidates an old search loop
  const stage = useRef<HTMLDivElement>(null);
  // phones: the panel sits below the mode tiles — bring the countdown / prompt into view
  useEffect(() => {
    if (phase !== 'idle' && window.innerWidth < 1000) stage.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [phase]);
  const stopPair = useRef<() => void>(() => {});

  const go = useCallback((id: string) => {
    run.current++;
    stopPair.current();
    setPhase('found');
    haptic('win');
    setTimeout(() => navigate(`/game?online=${id}`), 900);
  }, []);

  /* ---- lobby list + stats (polled; cheap RPCs) ---- */
  const refreshLobby = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([lobby(), lobbyStats()]);
      setPlayers(l);
      setStats(s);
    } catch {
      /* keep the last list */
    }
  }, []);
  useEffect(() => {
    void refreshLobby();
    const id = setInterval(refreshLobby, POLL_MS);
    return () => clearInterval(id);
  }, [refreshLobby]);

  /* ---- 1 s clock for countdowns ---- */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---- my challenge: accepted → play; declined → tell me ---- */
  useEffect(() => {
    if (!me) return;
    return watchSentChallenges(me.id, (row) => {
      setSent((cur) => {
        if (!cur || cur.id !== row.id) return cur;
        if (row.status === 'accepted' && row.match_id) go(row.match_id);
        else if (row.status === 'declined') {
          toast('info', t('lobby.declined', { name: cur.to.username }));
          haptic('error');
        }
        return row.status === 'pending' ? cur : null;
      });
    });
  }, [me?.id, go, t, toast]);
  // challenge expiry on the client side too
  useEffect(() => {
    if (sent && now - sent.at > CHALLENGE_TTL_MS) {
      toast('info', t('lobby.expired', { name: sent.to.username }));
      void cancelChallenge(sent.id).catch(() => {});
      setSent(null);
    }
  }, [now, sent, t, toast]);

  // leaving the page: stop searching
  useEffect(
    () => () => {
      run.current++;
      stopPair.current();
      void cancelQuickMatch().catch(() => {});
    },
    [],
  );

  /* ---- search for SEARCH_WINDOW_S seconds, then ask the player ---- */
  const search = async () => {
    if (!me) return;
    const my = ++run.current;
    setPhase('searching');
    setLeft(SEARCH_WINDOW_S);
    stopPair.current();
    stopPair.current = watchPairing(me.id, (id) => run.current === my && go(id));
    const started = Date.now();
    try {
      while (run.current === my) {
        const r = await quickMatch();
        if (run.current !== my) return;
        if (r.match_id) return go(r.match_id);
        const remaining = SEARCH_WINDOW_S - Math.floor((Date.now() - started) / 1000);
        setLeft(Math.max(0, remaining));
        if (remaining <= 0) break;
        void refreshLobby();
        await new Promise((res) => setTimeout(res, Math.min(POLL_MS, remaining * 1000)));
      }
      if (run.current !== my) return;
      await cancelQuickMatch().catch(() => {});
      setPhase('timeout');
      haptic('error');
    } catch {
      setPhase('idle');
      toast('error', t('quick.failed'));
    }
  };

  const stop = () => {
    run.current++;
    stopPair.current();
    setPhase('idle');
    void cancelQuickMatch().catch(() => {});
  };

  const playBot = async () => {
    setBusy('bot');
    try {
      const r = await startBotMatch('random');
      go(r.match_id);
    } catch {
      toast('error', t('bot.startFailed'));
    } finally {
      setBusy(null);
    }
  };

  const challenge = async (p: LobbyPlayer) => {
    setBusy(p.id);
    try {
      const r = await sendChallenge(p.id);
      setSent({ id: r.challenge_id, to: p, at: Date.now() });
      toast('success', t('lobby.sent', { name: p.username }));
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', t(/offline/.test(msg) ? 'lobby.err.offline' : /too many/.test(msg) ? 'lobby.err.tooFast' : 'lobby.err.send'));
    } finally {
      setBusy(null);
    }
  };
  const withdraw = async () => {
    if (!sent) return;
    await cancelChallenge(sent.id).catch(() => {});
    setSent(null);
  };

  return (
    <div>
      <h2>{t('mode.quick')}</h2>
      <p className="muted">{t('quick.desc60')}</p>

      <div className="match-stage" aria-live="polite" ref={stage}>
        {phase === 'idle' && (
          <button className="btn btn-primary btn-lg" onClick={search}>
            <LuSwords /> {t('mode.findOpponent')}
          </button>
        )}
        {phase === 'searching' && (
          <div className="searching">
            <div className="radar" aria-hidden="true">
              <span />
              <span />
              <span />
              {me && <Avatar name={me.username} seed={me.avatar} size={56} />}
            </div>
            <p className="search-title">{t('quick.searching')}</p>
            <div className="countdown" role="timer" aria-label={t('quick.left', { n: left })}>
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15.5" className="cd-track" />
                <circle cx="18" cy="18" r="15.5" className="cd-fill" style={{ strokeDashoffset: `${(1 - left / SEARCH_WINDOW_S) * 97.4}` }} />
              </svg>
              <span>{left}</span>
            </div>
            <button className="btn btn-ghost" onClick={stop}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        {phase === 'timeout' && (
          <div className="searching">
            <LuClock className="state-icon" />
            <p className="search-title">{t('quick.timeoutTitle')}</p>
            <p className="muted small">{t('quick.timeoutBody')}</p>
            <div className="row-actions center">
              <button className="btn btn-primary" onClick={playBot} disabled={busy === 'bot'}>
                {busy === 'bot' ? <LuLoader className="spin" /> : <LuBot />} {t('quick.playBot')}
              </button>
              <button className="btn btn-secondary" onClick={search}>
                <LuClock /> {t('quick.waitMore')}
              </button>
              <button className="btn btn-ghost" onClick={() => setPhase('idle')}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
        {phase === 'found' && (
          <div className="found">
            <p className="search-title">
              <LuCheck /> {t('quick.found')}
            </p>
          </div>
        )}
      </div>

      <section className="lobby" aria-labelledby="lobby-title">
        <div className="lobby-head">
          <h3 id="lobby-title">{t('lobby.title')}</h3>
          <div className="lobby-stats">
            <span className="online-now">
              <span className="dot dot-on" /> {stats ? num(stats.online) : '…'} {t('lobby.online')}
            </span>
            <span className="online-now">
              <LuUsers /> {stats ? num(stats.searching) : '…'} {t('lobby.searching')}
            </span>
          </div>
        </div>
        {sent && (
          <div className="notice">
            <LuSend />
            <span>
              {t('lobby.waitingFor', { name: sent.to.username, n: Math.max(0, Math.ceil((CHALLENGE_TTL_MS - (now - sent.at)) / 1000)) })}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={withdraw}>
              {t('lobby.withdraw')}
            </button>
          </div>
        )}
        {players.length === 0 ? (
          <p className="muted small lobby-empty">{t('lobby.empty')}</p>
        ) : (
          <ul className="rows">
            {players.map((p) => (
              <li key={p.id} className="row row-static">
                <Avatar name={p.username} seed={p.avatar} size={38} online />
                <span className="row-main">
                  <span className="row-title">
                    {p.username}
                    <LevelBadge rating={p.rating} label={(n) => t('level.short', { n })} />
                  </span>
                  <span className="row-sub">
                    {num(p.rating)} · {t('lobby.waitingSec', { n: p.waiting_seconds })}
                  </span>
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => challenge(p)} disabled={busy === p.id || sent?.to.id === p.id}>
                  {busy === p.id ? <LuLoader className="spin" /> : <LuSwords />} {sent?.to.id === p.id ? t('lobby.sentShort') : t('lobby.challenge')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** App-wide: shows "X challenges you" with Accept / Decline as soon as a challenge arrives. */
export function ChallengeInbox() {
  const { t, num } = useI18n();
  const { me, mode, signedIn } = useAuth();
  const { toast } = useToast();
  const { path } = useRoute();
  const [list, setList] = useState<IncomingChallenge[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setList(await incomingChallenges());
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (mode !== 'live' || !signedIn || !me) return;
    void load();
    const stop = watchIncomingChallenges(me.id, () => void load());
    const id = setInterval(load, 15000); // safety net if realtime drops
    return () => {
      stop();
      clearInterval(id);
    };
  }, [mode, signedIn, me?.id, load]);
  useEffect(() => {
    if (list.length === 0) return;
    haptic('move');
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [list.length]);

  const c = list.find((x) => now - new Date(x.created_at).getTime() < CHALLENGE_TTL_MS) ?? null;
  const inGame = path.startsWith('/game');
  if (!c) return null;
  const secs = Math.max(0, Math.ceil((CHALLENGE_TTL_MS - (now - new Date(c.created_at).getTime())) / 1000));

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      const r = await respondChallenge(c.id, accept);
      setList((l) => l.filter((x) => x.id !== c.id));
      if (accept && r.match_id) navigate(`/game?online=${r.match_id}`);
    } catch {
      toast('error', t('lobby.err.answer'));
      setList((l) => l.filter((x) => x.id !== c.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => answer(false)} title={t('lobby.incomingTitle')} locked={busy}>
      <div className="challenge-card">
        <Avatar name={c.username} seed={c.avatar} size={72} />
        <strong className="challenge-name">
          {c.username} <LevelBadge rating={c.rating} label={(n) => t('level.short', { n })} />
        </strong>
        <span className="muted">
          {t('common.rating')}: {num(c.rating)}
        </span>
        <p>{t('lobby.incomingBody', { name: c.username })}</p>
        {inGame && <p className="muted small">{t('lobby.inGameNote')}</p>}
        <p className="muted small">{t('lobby.expiresIn', { n: secs })}</p>
        <div className="row-actions center">
          <button className="btn btn-primary btn-lg" onClick={() => answer(true)} disabled={busy}>
            {busy ? <LuLoader className="spin" /> : <LuCheck />} {t('lobby.accept')}
          </button>
          <button className="btn btn-danger" onClick={() => answer(false)} disabled={busy}>
            <LuX /> {t('lobby.decline')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
