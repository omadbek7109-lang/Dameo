import { useCallback, useEffect, useRef, useState } from 'react';
import { LuBot, LuCheck, LuClock, LuInfo, LuLoader, LuSend, LuSwords, LuUsers, LuX } from 'react-icons/lu';
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
  virtualMatch,
  watchIncomingChallenges,
  watchPairing,
  watchSentChallenges,
  type IncomingChallenge,
  type LobbyPlayer,
  type VirtualPlayer,
} from '../services/online.ts';
import { DEFAULT_TIME_CONTROL, isTimeControl, TIME_CONTROLS, type TimeControl } from '../services/clock.ts';
import { SbError } from '../services/supabase.ts';
import { haptic, tg, everyActive } from '../services/telegram.ts';
import { Avatar, LevelBadge } from './Avatar.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

export const SEARCH_WINDOW_S = 60;
/** a virtual opponent may be found at a random moment in this range (s) — the 60 s search window itself is unchanged */
export const VIRTUAL_AFTER_S: [number, number] = [20, 35];
const virtualDelayMs = () => Math.round((VIRTUAL_AFTER_S[0] + Math.random() * (VIRTUAL_AFTER_S[1] - VIRTUAL_AFTER_S[0])) * 1000);
const POLL_MS = 4000;

type Phase = 'idle' | 'searching' | 'timeout' | 'found';

const TC_KEY = 'dameo.timeControl';
const loadTc = (): TimeControl => {
  try {
    const n = Number(localStorage.getItem(TC_KEY));
    return isTimeControl(n) ? n : DEFAULT_TIME_CONTROL;
  } catch {
    return DEFAULT_TIME_CONTROL;
  }
};

/** Live matchmaking: 60 s search → offer bot or keep waiting; plus the lobby list with direct challenges. */
export function LiveQuickPanel({ autoStart = 0 }: { autoStart?: number }) {
  const { t, num } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  /** search deadline in LOCAL clock ms, derived from the server's search start (null until the first answer) */
  const deadline = useRef<number | null>(null);
  /** cuts the polling sleep short (deadline reached, app back in foreground) */
  const wake = useRef<() => void>(() => {});
  const [left, setLeft] = useState(SEARCH_WINDOW_S);
  /** chosen time control (1 / 3 / 5 min); players are only paired with the same one */
  const [tc, setTcState] = useState<TimeControl>(loadTc);
  const tcRef = useRef<TimeControl>(tc);
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
  const [foundOpp, setFoundOpp] = useState<VirtualPlayer | null>(null);

  const go = useCallback((id: string, virtual?: VirtualPlayer | null) => {
    run.current++;
    stopPair.current();
    setFoundOpp(virtual ?? null);
    setPhase('found');
    haptic('win');
    // a virtual opponent's card stays a moment longer so the player sees who it is
    setTimeout(() => navigate(`/game?online=${id}`), virtual ? 2200 : 900);
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
    return everyActive(refreshLobby, POLL_MS);
  }, [refreshLobby]);

  /* ---- 1 s clock for countdowns ---- */
  useEffect(() => {
    return everyActive(() => setNow(Date.now()), 1000);
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

  /* ---- search for SEARCH_WINDOW_S seconds, then ask the player ----
     The countdown is computed from a deadline anchored to the SERVER's search start
     (quick_match → searching_since, corrected for clock skew with server_now), and is
     re-evaluated every 250 ms, so polling delays, slow networks, background tabs or a
     re-activated Telegram WebApp cannot make it drift or restart. */
  const remainingNow = () => (deadline.current === null ? SEARCH_WINDOW_S : Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));

  const search = async (pick?: TimeControl) => {
    if (!me) return;
    // one search at a time: ignore repeated taps while searching / matched
    if (phaseRef.current === 'searching' || phaseRef.current === 'found') return;
    if (pick) {
      tcRef.current = pick;
      setTcState(pick);
      try {
        localStorage.setItem(TC_KEY, String(pick));
      } catch {
        /* private mode */
      }
    }
    const timeControl = tcRef.current;
    const my = ++run.current;
    deadline.current = null;
    // local moment (20–35 s in) to ask for a virtual opponent if no real player has turned up
    let virtualAt = Date.now() + virtualDelayMs();
    let virtualAsked = 0;
    setLeft(SEARCH_WINDOW_S);
    setPhase('searching');
    stopPair.current();
    stopPair.current = watchPairing(me.id, (id) => run.current === my && go(id));
    try {
      while (run.current === my) {
        const t0 = Date.now();
        const r = await quickMatch(timeControl);
        const t1 = Date.now();
        if (run.current !== my) return;
        if (r.match_id) return go(r.match_id);
        if (deadline.current === null) {
          const since = r.searching_since ? Date.parse(r.searching_since) : NaN;
          const server = r.server_now ? Date.parse(r.server_now) : NaN;
          const skew = Number.isFinite(server) ? server - (t0 + t1) / 2 : 0; // server clock − local clock
          let d = Number.isFinite(since) ? since + SEARCH_WINDOW_S * 1000 - skew : t0 + SEARCH_WINDOW_S * 1000;
          d = Math.min(d, t1 + SEARCH_WINDOW_S * 1000); // never longer than the window
          deadline.current = d;
          setLeft(remainingNow());
        }
        if (Date.now() >= deadline.current) break;
        if (Date.now() >= virtualAt && virtualAsked < 3) {
          virtualAsked++;
          const v = await virtualMatch(timeControl).catch(() => null);
          if (run.current !== my) return;
          if (v?.match_id) return go(v.match_id, v.virtual ?? null);
          // switched off → keep searching as before; asked too early (server clock) → try again a little later
          virtualAt = v?.reason === 'too-early' ? Date.now() + 2500 : Infinity;
        }
        void refreshLobby();
        await new Promise<void>((res) => {
          const id = setTimeout(res, Math.max(200, Math.min(POLL_MS, deadline.current! - Date.now(), virtualAt - Date.now())));
          wake.current = () => {
            clearTimeout(id);
            res();
          };
        });
      }
      if (run.current !== my) return;
      run.current++; // stop this search everywhere (pairing watcher, ticker)
      stopPair.current();
      await cancelQuickMatch().catch(() => {});
      setLeft(0);
      setPhase('timeout');
      haptic('error');
    } catch {
      if (run.current !== my) return;
      run.current++;
      stopPair.current();
      setPhase('idle');
      toast('error', t('quick.failed'));
    }
  };

  // countdown from the server-anchored deadline, re-evaluated 4× per second
  useEffect(() => {
    if (phase !== 'searching') return;
    const tick = () => {
      setLeft(remainingNow());
      if (deadline.current !== null && Date.now() >= deadline.current) wake.current();
    };
    tick();
    const id = setInterval(tick, 250);
    // back from background / Telegram re-activated: recompute at once and ping the server immediately
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        tick();
        wake.current();
      }
    };
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Tapping the "Find opponent" card opens the time choice; tapping a time starts the search at once.
  const lastAuto = useRef(0);
  useEffect(() => {
    if (autoStart > lastAuto.current) {
      lastAuto.current = autoStart;
      if (phaseRef.current === 'idle' && window.innerWidth < 1000) stage.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [autoStart]);

  const stop = () => {
    run.current++;
    stopPair.current();
    wake.current();
    deadline.current = null;
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
          <div className="tc-pick">
            <p className="search-title">{t('quick.pickTime')}</p>
            <div className="tc-options" role="group" aria-label={t('quick.pickTime')}>
              {TIME_CONTROLS.map((n) => (
                <button key={n} className={`tc-option ${n === tc ? 'tc-last' : ''}`} onClick={() => void search(n)}>
                  <LuClock />
                  <strong>{n / 60}</strong>
                  <span>{t('tc.minLabel')}</span>
                </button>
              ))}
            </div>
            <p className="muted small">{t('tc.rule')}</p>
            <p className="muted small mm-rule">
              <LuInfo /> {t('virtual.rule')}
            </p>
          </div>
        )}
        {phase === 'searching' && (
          <div className="searching">
            <div className="radar" aria-hidden="true">
              <span />
              <span />
              <span />
              {me && <Avatar name={me.username} seed={me.avatar} size={56} />}
            </div>
            <p className="search-title">{deadline.current === null ? t('quick.connecting') : t('quick.searching')}</p>
            <span className="badge tc-badge">
              <LuClock /> {t('tc.minutes', { n: tc / 60 })}
            </span>
            <div className="countdown" role="timer" aria-label={t('quick.left', { n: left })}>
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15.5" className="cd-track" />
                <circle cx="18" cy="18" r="15.5" className="cd-fill" style={{ strokeDashoffset: `${(1 - left / SEARCH_WINDOW_S) * 97.4}` }} />
              </svg>
              <span>{left}</span>
            </div>
            <p className="muted small mm-rule">
              <LuInfo /> {t('virtual.rule')}
            </p>
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
              <button className="btn btn-secondary" onClick={() => void search()}>
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
            {foundOpp && me && (
              <div className="vs vs-pop">
                <div className="vs-side">
                  <Avatar name={me.username} seed={me.avatar} size={64} userId={me.id} />
                  <strong>{me.username}</strong>
                  <span className="muted small">{num(me.rating)}</span>
                </div>
                <span className="vs-badge">VS</span>
                <div className="vs-side">
                  <Avatar name={foundOpp.nickname} seed={foundOpp.avatar} size={64} />
                  <strong>
                    {foundOpp.nickname}
                  </strong>
                  <span className="muted small">{num(foundOpp.rating)}</span>
                  <span className="vs-stats">
                    {t('vs.stats', { g: num(foundOpp.wins + foundOpp.losses + foundOpp.draws), w: num(foundOpp.wins) })}
                  </span>
                </div>
              </div>
            )}
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
              <LuUsers /> {num(players.length)} {t('lobby.searching')}
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
                <Avatar name={p.username} seed={p.avatar} size={38} online userId={p.id} />
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
    const off = everyActive(load, 30_000); // safety net if realtime drops
    return () => {
      stop();
      off();
    };
  }, [mode, signedIn, me?.id, load]);
  useEffect(() => {
    if (list.length === 0) return;
    haptic('move');
    return everyActive(() => setNow(Date.now()), 1000);
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
