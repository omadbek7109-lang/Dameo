import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LuArrowLeft, LuBookOpen, LuCrown, LuEye, LuEyeOff, LuFlag, LuHandshake, LuLightbulb, LuLoader, LuRotateCcw, LuSwords, LuTimer, LuUndo2, LuWifiOff } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { Difficulty } from '../bot/ai.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Board } from '../components/Board.tsx';
import { Confetti } from '../components/Confetti.tsx';
import { Modal } from '../components/Modal.tsx';
import { FairPlayNotice } from '../components/FairPlayNotice.tsx';
import { RulesDialog } from '../components/RulesDialog.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCountUp } from '../hooks/useCountUp.ts';
import { useCheckers, type GameConfig, type GameKind } from '../hooks/useCheckers.ts';
import { countPieces, type Color, type GameResult } from '../engine/index.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { DEMO_PLAYERS } from '../services/demoData.ts';
import { clockView, formatClock, GRACE_MS, LAG_COMP_MS } from '../services/clock.ts';
import { claimTimeout, isTransient, commitBotMove, getMatch, getMoves, resignOnline, startBotMatch, submitMove, toLocalMs, watchMatch, type OnlineMatch } from '../services/online.ts';
import { Link } from '../router.tsx';
import { AchievementUnlocked } from '../components/Achievements.tsx';
import { achievementsForMatch, type StreakCode } from '../services/achievements.ts';
import { appActive, haptic, tg, everyActive } from '../services/telegram.ts';
import { offerDraw, offerRematch, setMatchVisibility, chatErrorKey } from '../services/live.ts';
import { moveSound, playSound } from '../services/sound.ts';
import { MatchChat } from '../components/MatchChat.tsx';
import { SbError, currentRtMode } from '../services/supabase.ts';
import type { ConnectionState } from '../services/supabase.ts';
import { useCosmetics, useMatchSkin } from '../cosmetics/CosmeticsProvider.tsx';
import { db } from '../services/supabase.ts';
import { useSettings } from '../settings/SettingsProvider.tsx';
import { botLevelFor } from './Play.tsx';
import { useWorn } from '../components/PassArt.tsx';
import { VictoryFx } from '../components/VictoryFx.tsx';
import { getPass, getPassRecent } from '../services/pass/index.ts';
import { levelOf } from '../services/pass/core.ts';

/* ------------------------------------------------------------------ */

interface PlayerInfo {
  name: string;
  rating?: number;
  seed?: string;
  /** player id (avatar frame) */
  id?: string | null;
  /** a virtual (AI) opponent: shown with the AI badge, the name opens its profile */
  ai?: boolean;
  link?: string;
  color: Color;
  tag?: string;
  /** game clock (timed online games) */
  clock?: { ms: number; active: boolean; moveLeftMs: number | null; warn: boolean };
}
interface ResultInfo {
  outcome: 'win' | 'loss' | 'draw' | 'neutral';
  winnerColor: Color | null;
  reason: string;
  rated: boolean;
  demo: boolean;
  before?: number;
  after?: number;
  /** DAMEO Coins the server paid for this game (null = still checking, undefined = not applicable) */
  coins?: number | null;
  /** total moves in the game (coins need at least 12) */
  moves?: number;
}

const reasonKey = (r: GameResult): TKey => {
  if (r.status === 'won') return r.reason === 'resign' ? 'reason.resign' : 'reason.no-moves';
  if (r.status === 'draw') return r.reason === 'repetition' ? 'reason.repetition' : r.reason === 'kings-only' ? 'reason.kings-only' : 'reason.agreement';
  return 'reason.no-moves';
};

export function Game() {
  const route = useRoute();
  const online = route.query.get('online');
  if (online) return <OnlineGame key={online} matchId={online} />;
  return <LocalGame key={route.path + route.query.toString()} />;
}

/* ------------------------------ Local games ------------------------------ */

function LocalGame() {
  const { t } = useI18n();
  const route = useRoute();
  const { me, recordDemoResult, notify, mode: appMode } = useAuth();
  const q = route.query;
  const kind = (['bot', 'practice', 'local', 'demo-rated'].includes(q.get('mode') ?? '') ? q.get('mode') : 'bot') as GameKind;
  const demoOpp = useMemo(() => DEMO_PLAYERS.find((p) => p.id === q.get('opp')), [q]);
  const level: Difficulty = kind === 'demo-rated' ? botLevelFor(demoOpp?.rating ?? 1200) : ((['easy', 'medium', 'hard'].includes(q.get('level') ?? '') ? q.get('level') : 'medium') as Difficulty);
  const humanColor: Color = kind === 'demo-rated' ? 'w' : q.get('side') === 'b' ? 'b' : 'w';
  // vs the computer: my set only on my pieces, the bot keeps the standard ones (practice / pass-and-play: all mine)
  const skin = useMatchSkin(kind === 'bot' || kind === 'demo-rated' ? { white: humanColor === 'w' ? 'me' : null, black: humanColor === 'b' ? 'me' : null } : null);
  const cfg: GameConfig = useMemo(() => ({ kind, difficulty: level, humanColor }), [kind, level, humanColor]);

  const g = useCheckers(cfg);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const recorded = useRef(false);
  const [gameNo, setGameNo] = useState(0);

  useEffect(() => {
    const r = g.game.result;
    if (r.status === 'playing' || recorded.current) return;
    recorded.current = true;
    const winnerColor = r.status === 'won' ? r.winner : null;
    if (kind === 'local') {
      setResult({ outcome: r.status === 'draw' ? 'draw' : 'neutral', winnerColor, reason: t(reasonKey(r)), rated: false, demo: false });
      return;
    }
    const outcome: 'win' | 'loss' | 'draw' = r.status === 'draw' ? 'draw' : winnerColor === humanColor ? 'win' : 'loss';
    const rated = kind === 'demo-rated';
    const opponentName = kind === 'practice' ? t('mode.practice') : rated && demoOpp ? demoOpp.username : t(`bot.${level}` as 'bot.easy');
    const rec = recordDemoResult({
      opponent: kind === 'bot' ? `${t('game.computer')} · ${opponentName}` : opponentName,
      opponentRating: demoOpp?.rating ?? 1200,
      result: outcome,
      mode: kind,
      moves: g.game.history.length,
      difficulty: kind === 'bot' ? level : undefined,
      rated,
    });
    if (rated && appMode === 'demo') {
      notify('rating', t('notif.rating', { delta: rec.delta > 0 ? `+${rec.delta}` : String(rec.delta), rating: rec.after }));
    }
    setResult({ outcome, winnerColor, reason: t(reasonKey(r)), rated, demo: true, before: rec.before, after: rec.after });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.game.result]);

  // sounds for local games (no server to wait for)
  const heard = useRef(0);
  useEffect(() => {
    const h = g.game.history;
    if (h.length > heard.current) playSound(moveSound(h[h.length - 1], kind === 'local' || h[h.length - 1].color === humanColor));
    heard.current = h.length;
  }, [g.game.history.length]);

  const restart = useCallback(() => {
    recorded.current = false;
    setResult(null);
    setGameNo((n) => n + 1);
    g.restart();
  }, [g]);

  const opponentName =
    kind === 'local' ? t('game.player2') : kind === 'demo-rated' ? (demoOpp?.username ?? t('quick.opponent')) : `${t('game.computer')} · ${t(`bot.${level}` as 'bot.easy')}`;
  const oppColor: Color = humanColor === 'w' ? 'b' : 'w';
  const top: PlayerInfo = { name: opponentName, rating: demoOpp && kind === 'demo-rated' ? demoOpp.rating : undefined, seed: demoOpp?.avatar, color: oppColor, tag: kind === 'demo-rated' ? t('demo.badge') : undefined };
  const bottom: PlayerInfo = { name: kind === 'local' ? t('game.player1') : (me?.username ?? t('common.you')), rating: kind === 'local' ? undefined : me?.rating, seed: me?.avatar, id: kind === 'local' ? null : me?.id, color: humanColor };

  return (
    <GameScreen
      key={gameNo}
      g={g}
      kind={kind}
      humanColor={humanColor}
      top={top}
      bottom={bottom}
      canRestart={kind !== 'demo-rated'}
      canUndo={kind === 'practice' || kind === 'local'}
      canHint={kind === 'practice'}
      canDraw={kind === 'local'}
      onResign={() => g.resign(kind === 'local' ? g.game.turn : humanColor)}
      onRestart={restart}
      result={result}
      onPlayAgain={kind === 'demo-rated' ? () => navigate('/play?mode=quick') : restart}
      onExit={() => navigate('/play')}
      skin={skin}
    />
  );
}

/* ------------------------------ Online games ------------------------------ */

function OnlineGame({ matchId }: { matchId: string }) {
  const cos = useCosmetics();
  const { t } = useI18n();
  const { me, matches, refresh } = useAuth();
  const { toast } = useToast();
  const [match, setMatch] = useState<OnlineMatch | null>(null);
  const [error, setError] = useState(false);
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [result, setResult] = useState<ResultInfo | null>(null);
  const humanColor: Color = match && me && match.blackId === me.id ? 'b' : 'w';
  const skin = useMatchSkin(
    match ? { white: match.whiteId, black: match.vsBot ? null : (match.blackId ?? null), whiteRating: match.whiteRating, blackRating: match.blackRating } : null,
  );
  const cfg: GameConfig = useMemo(() => ({ kind: 'online', humanColor }), [humanColor]);

  const resync = useCallback(async (loadMoves: (m: Array<{ from: number; path: number[] }>) => void) => {
    const moves = await getMoves(matchId);
    loadMoves(moves);
  }, [matchId]);

  const [waitingServer, setWaitingServer] = useState(false);
  const [sendTry, setSendTry] = useState(0); // >0: the move is being sent again (slow internet)
  // when this device first showed that it is my turn (local clock) — the server gives back network delay with it
  const turnSeen = useRef(Date.now());
  const sending = useRef(false);
  const loadedOnce = useRef(false);
  const lastLive = useRef(Date.now());
  const g = useCheckers(cfg, {
    onHumanMove: async (mv) => {
      setWaitingServer(true);
      setSendTry(0);
      sending.current = true;
      const myParity = humanColorRef.current === 'w' ? 0 : 1;
      const len = gRef.current.game.history.length; // the local copy may or may not include this move yet
      const ply = len % 2 === myParity ? len : len - 1;
      const thinkMs = Date.now() - turnSeen.current;
      try {
        const r = await submitMove(matchId, mv.from, mv.path, { ply, thinkMs }, (n) => setSendTry(n));
        if (!r.ok) throw new Error(r.error);
        // sound only once the server has accepted the move
        const mineRec = gRef.current.game.history.find((h, i) => i >= 0 && h.from === mv.from && h.path.join() === mv.path.join());
        playSound(moveSound(mineRec, true));
        // my clock stops and the opponent's starts right away (the realtime row update confirms it)
        const c = r.clock;
        if (c?.turn_started_at && c.white_ms != null && c.black_ms != null) {
          const plies = gRef.current.game.history.length;
          setMatch((m) =>
            m?.clock && m.clock.moveCount < plies
              ? { ...m, clock: { ...m.clock, whiteMs: c.white_ms!, blackMs: c.black_ms!, turnStartedAt: toLocalMs(c.turn_started_at!, m.skewMs), moveCount: plies } }
              : m,
          );
        }
        // virtual opponent: the server planned its reply — show "thinking" until it is due
        if (r.pending?.due_at) setMatch((m) => (m ? { ...m, botDueAt: toLocalMs(r.pending!.due_at, m.skewMs) } : m));
        // Server bot reply comes back in the same response (realtime delivers it too; the ply check de-duplicates).
        if (r.bot && gRef.current.game.history.length === r.bot.ply) {
          gRef.current.applyRemote(r.bot.from, r.bot.path);
          setTimeout(() => playSound(moveSound(gRef.current.game.history[r.bot!.ply], false)), 250);
        }
      } catch (e) {
        // Say exactly why the server refused the move, then re-sync the board from the server's copy.
        const code = e instanceof SbError ? e.message : isTransient(e) ? 'network' : 'server';
        const key = (
          {
            'not-your-turn': 'online.err.notYourTurn',
            'not-active': 'online.err.notActive',
            'must-capture': 'game.msg.mustCapture',
            illegal: 'game.msg.illegal',
            'not-your-piece': 'game.msg.notYours',
            conflict: 'online.err.conflict',
            timeout: 'online.err.timeout',
            unauthorized: 'online.err.unauthorized',
            network: 'online.err.network',
          } as Record<string, TKey>
        )[code] ?? 'online.moveRejected';
        toast('error', t(key));
        console.warn('[DAMEO] move rejected by server:', code);
        await resync(gRef.current.loadMoves).catch(() => {});
      } finally {
        sending.current = false;
        setWaitingServer(false);
        setSendTry(0);
      }
    },
  });
  const gRef = useRef(g);
  gRef.current = g;
  const humanColorRef = useRef(humanColor);
  humanColorRef.current = humanColor;
  // my turn just appeared on this screen (opponent's move arrived, or the game was (re)loaded) → start my think time
  const plies = g.game.history.length;
  useEffect(() => {
    if (g.game.turn === humanColor) turnSeen.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plies, humanColor]);

  const load = useCallback(async () => {
    try {
      setError(false);
      const m = await getMatch(matchId);
      if (!m) return setError(true);
      loadedOnce.current = true;
      setMatch(m);
      // my move is still on its way: don't replace the board with the server's copy that doesn't have it yet
      if (!sending.current) await resync(gRef.current.loadMoves);
    } catch {
      // slow / lost internet: keep the game on screen and try again shortly (error page only if nothing was loaded)
      if (!loadedOnce.current) setError(true);
      else lastLive.current = Date.now() - 1_000;
    }
  }, [matchId, resync]);

  // back from background / Telegram re-activated: re-read the game and the clock from the server
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
  }, [load]);

  /* ---- game clock: redrawn 4× per second from the server's numbers; the server decides timeouts ---- */
  const [now, setNow] = useState(Date.now());
  const ticking = Boolean(match?.clock) && match?.status === 'active';
  useEffect(() => {
    if (!ticking) return;
    return everyActive(() => setNow(Date.now()), 250);
  }, [ticking]);
  // my turn: count my 30 s from when the opponent's move appeared here (up to 3 s later than the server's start —
  // exactly what the server gives back for network delay)
  const shownClock =
    match?.clock && match.status === 'active' && match.clock.moveCount === plies && (match.clock.moveCount % 2 === 0 ? 'w' : 'b') === humanColor
      ? { ...match.clock, turnStartedAt: Math.min(match.clock.turnStartedAt + LAG_COMP_MS, Math.max(match.clock.turnStartedAt, turnSeen.current)) }
      : match?.clock;
  const view = shownClock ? clockView(shownClock, match!.status === 'active' ? now : shownClock.turnStartedAt) : null;
  // the side to move is out of time → ask the server to end the game (either player may ask; the server re-checks)
  const claimed = useRef(-1);
  useEffect(() => {
    if (!view || !match?.clock || match.status !== 'active') return;
    if (now < view.deadline + GRACE_MS + LAG_COMP_MS + 400 || claimed.current === match.clock.moveCount) return;
    claimed.current = match.clock.moveCount;
    claimTimeout(matchId)
      .then(async (r) => {
        const fresh = await getMatch(matchId);
        if (fresh) setMatch(fresh);
        if (!r.ended) setTimeout(() => (claimed.current = -1), 2000); // our clock was ahead; ask again shortly
      })
      .catch(() => setTimeout(() => (claimed.current = -1), 2000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
  // virtual opponent: commit its planned move when it is due (the server checks the time and charges its clock;
  // if this app is closed, the server's sweep commits it instead)
  const committing = useRef<number | null>(null);
  useEffect(() => {
    if (!match?.virtual || match.status !== 'active' || !match.botDueAt) return;
    const due = match.botDueAt;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const commit = async (tries: number) => {
      if (committing.current === due) return;
      committing.current = due;
      try {
        const r = await commitBotMove(matchId);
        const b = r.bot;
        if (b && gRef.current.game.history.length === b.ply) {
          gRef.current.applyRemote(b.from, b.path);
          setTimeout(() => playSound(moveSound(gRef.current.game.history[b.ply], false)), 30);
        }
        const c = r.clock;
        setMatch((m) =>
          m && m.clock && c?.turn_started_at && c.white_ms != null && c.black_ms != null
            ? { ...m, botDueAt: null, clock: { ...m.clock, whiteMs: c.white_ms, blackMs: c.black_ms, turnStartedAt: toLocalMs(c.turn_started_at, m.skewMs), moveCount: (b?.ply ?? m.clock.moveCount) + 1 } }
            : m ? { ...m, botDueAt: null } : m,
        );
        if (!b) void load(); // e.g. the bot ran out of time
      } catch (e) {
        committing.current = null;
        const code = e instanceof SbError ? e.message : '';
        // a little early by the server's clock → ask again shortly; anything else: re-read (the server sweep moves it anyway)
        if (code === 'too-early' && tries < 4) retry = setTimeout(() => void commit(tries + 1), 450);
        else void load();
      }
    };
    const id = setTimeout(() => void commit(0), Math.max(0, due - Date.now()) + 60);
    return () => {
      clearTimeout(id);
      if (retry) clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.botDueAt, match?.status, matchId]);
  const lowWarned = useRef(-1);
  useEffect(() => {
    if (!view || !match?.clock || match.status !== 'active' || view.side !== humanColor) return;
    if (view.moveLeftMs <= 10_000 && view.moveLeftMs > 0 && lowWarned.current !== match.clock.moveCount) {
      lowWarned.current = match.clock.moveCount;
      haptic('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // Broadcast mode safety net: a live notification can be lost (e.g. a network blip) — if an active game has been
  // quiet for 20 s, re-read it from the server (2 small reads; the old postgres_changes path is unaffected)
  // Slow / dropping internet: while the live connection is down, re-read the game every ~3 s; the internet coming back
  // re-reads at once.
  const activeGame = match?.status === 'active';
  const connRef = useRef(conn);
  connRef.current = conn;
  useEffect(() => {
    if (!activeGame) return;
    let downReads = 0; // re-reads while the live connection is down: 3 s → 6 s → 12 s (server load)
    const id = setInterval(() => {
      if (!appActive()) return;
      const quiet = Date.now() - lastLive.current;
      const down = connRef.current !== 'open';
      if (!down) downReads = 0;
      const wait = down ? Math.min(12_000, 3_000 * 2 ** Math.min(downReads, 2)) : 20_000;
      if ((down && quiet > wait) || (currentRtMode() === 'broadcast' && quiet > 20_000)) {
        lastLive.current = Date.now();
        if (down) downReads++;
        void load();
      }
    }, 1_000);
    const back = () => void load();
    window.addEventListener('online', back);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', back);
    };
  }, [activeGame, load]);

  useEffect(() => {
    void load();
    return watchMatch(matchId, {
      onMove: (mv) => {
        lastLive.current = Date.now();
        const have = gRef.current.game.history.length;
        if (mv.ply === have) {
          turnSeen.current = Date.now();
          gRef.current.applyRemote(mv.from, mv.path);
          setTimeout(() => playSound(moveSound(gRef.current.game.history[mv.ply], false)), 30);
        }
        else if (mv.ply > have) void resync(gRef.current.loadMoves).catch(() => {}); // missed a move while offline
      },
      onMatch: (m) => {
        lastLive.current = Date.now();
        setMatch(m);
      },
      onStatus: (s) => {
        setConn(s);
        if (s === 'open') void load(); // refetch after every (re)connect
      },
    });
  }, [matchId, load, resync]);

  // finalised on the server → show the result using the server's verdict
  const shown = useRef(false);
  useEffect(() => {
    if (!match || match.status !== 'finished' || shown.current || (!match.blackId && !match.vsBot)) return;
    shown.current = true;
    const winnerColor: Color | null = match.result === 'white' ? 'w' : match.result === 'black' ? 'b' : null;
    if (g.game.result.status === 'playing') g.finishExternal(winnerColor, match.reason === 'resign' ? 'resign' : 'no-moves');
    const outcome = winnerColor === null ? 'draw' : winnerColor === humanColor ? 'win' : 'loss';
    const reason = match.timeoutKind
      ? t(match.timeoutKind === 'move' ? 'reason.timeoutMove' : 'reason.timeoutClock')
      : t(match.reason === 'resign' ? 'reason.resign' : winnerColor ? 'reason.no-moves' : 'reason.agreement');
    const moves = Math.max(match.moveCount, gRef.current.game.history.length);   // the server's count (moves may still be loading)
    const paid = match.rated && outcome !== 'draw' && moves >= 12;   // the server's rule (0026): win +20, loss +10
    void refresh().then(() => {
      setResult({ outcome, winnerColor, reason, rated: match.rated, demo: false, coins: match.rated && outcome !== 'draw' ? (paid ? null : 0) : undefined, moves });
    });
    // DAMEO Coins for this game: read what the server credited (never computed here)
    if (paid) {
      const look = (tries: number) =>
        db.rpc<{ coins: number; settled?: boolean; balance: number }>('match_coins', { p_match: match.id }).then(
          (r) => {
            if (r && r.coins > 0) {
              setResult((x) => (x ? { ...x, coins: r.coins } : x));
              void cos?.refreshWallet();
            } else if (tries > 0 && !r?.settled) setTimeout(() => look(tries - 1), 1500);
            else setResult((x) => (x ? { ...x, coins: 0 } : x));
          },
          () => (tries > 0 ? setTimeout(() => look(tries - 1), 1500) : setResult((x) => (x ? { ...x, coins: 0 } : x))),
        );
      setTimeout(() => look(4), 700);
    }
    // achievements this game unlocked (coins are paid by the server) → congratulations
    if (match.rated && outcome === 'win') {
      const look = (tries: number) =>
        achievementsForMatch(match.id).then(
          (a) => (Array.isArray(a) && a.length > 0 ? setAchPop(a) : tries > 0 && setTimeout(() => look(tries - 1), 2500)),
          () => {},
        );
      setTimeout(() => look(2), 1200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);
  const [achPop, setAchPop] = useState<Array<{ code: StreakCode; reward: number }> | null>(null);

  // fill in rating numbers once the refreshed history contains this match
  const mine = matches.find((m) => m.id === matchId);
  const finalResult: ResultInfo | null = result && mine && me ? { ...result, before: me.rating - mine.delta, after: me.rating } : result;



  if (error) return <div className="page"><ErrorState onRetry={load} /></div>;
  if (!match || !me) return <div className="page"><Spinner /></div>;
  if (match.status === 'waiting') {
    return (
      <div className="page">
        <div className="card state">
          <LuLoader className="spin state-icon" />
          <div className="state-title">{t('room.waiting')}</div>
          {match.code && <div className="room-code">{match.code}</div>}
          <button className="btn btn-ghost" onClick={() => navigate('/play')}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }
  const iAmWhite = humanColor === 'w';
  const pvp = !match.vsBot && !!match.blackId;
  const virtualOpp = match.virtual;
  const opp = virtualOpp
    ? { name: match.blackName ?? '', rating: match.blackRating ?? undefined, seed: virtualOpp.avatar ?? undefined, ai: true, link: `/vp/${virtualOpp.id}` }
    : match.vsBot
    ? { name: `${t('game.botName')} · ${t(`bot.${match.botLevel ?? 'medium'}` as 'bot.easy')}`, rating: undefined, tag: t('game.botTag') }
    : { name: (iAmWhite ? match.blackName : match.whiteName) ?? t('quick.opponent'), rating: (iAmWhite ? match.blackRating : match.whiteRating) ?? undefined, id: iAmWhite ? match.blackId : match.whiteId };
  const clockFor = (c: Color): PlayerInfo['clock'] => {
    if (!view) return undefined;
    const active = match.status === 'active' && view.side === c;
    const moveLeftMs = active ? view.moveLeftMs : null;
    return { ms: c === 'w' ? view.whiteMs : view.blackMs, active, moveLeftMs, warn: active && view.moveLeftMs <= 10_000 };
  };
  const topColor: Color = iAmWhite ? 'b' : 'w';
  const top: PlayerInfo = { ...opp, color: topColor, clock: clockFor(topColor) };
  const bottom: PlayerInfo = { name: me.username, rating: me.rating, seed: me.avatar, id: me.id, color: humanColor, clock: clockFor(humanColor) };
  const clockNote =
    match.clock && match.status === 'active' && match.clock.moveCount === 0 ? (
      <div className="notice" role="status">
        <LuTimer /> <span>{t('game.clockHint', { n: match.clock.timeControl / 60 })}</span>
      </div>
    ) : undefined;

  return (
    <GameScreen
      g={g}
      kind="online"
      humanColor={humanColor}
      top={top}
      bottom={bottom}
      canRestart={false}
      canUndo={false}
      canHint={false}
      canDraw={false}
      onResign={() =>
        resignOnline(matchId)
          .then(() => load()) // don't depend on the realtime update alone
          .catch(() => toast('error', t('online.resignFailed')))
      }
      onRestart={() => {}}
      result={finalResult}
      onPlayAgain={
        virtualOpp
          ? () => navigate('/play?mode=quick')
          : match.vsBot
          ? () =>
              startBotMatch(match.botLevel ?? 'random')
                .then((r) => navigate(`/game?online=${r.match_id}`))
                .catch(() => toast('error', t('bot.startFailed')))
          : () => navigate('/play?mode=quick')
      }
      onExit={() => navigate('/play')}
      serverThinking={(waitingServer && match.vsBot && !virtualOpp) || (!!virtualOpp && match.status === 'active' && match.botDueAt !== null)}
      skin={skin}
      extraControls={
        pvp ? (
          <>
            <button
              className="ga"
              disabled={match.status !== 'active'}
              onClick={() =>
                offerDraw(matchId)
                  .then(() => toast('success', t('chat.drawSent')))
                  .catch((e) => toast('error', t(chatErrorKey(e instanceof SbError ? e.message : ''))))
              }
            >
              <span className="ga-ico"><LuHandshake /></span>
              {t('chat.offerDraw')}
            </button>
            <button
              className="ga"
              onClick={() =>
                setMatchVisibility(matchId, !match.isPublic)
                  .then(() => load())
                  .catch(() => toast('error', t('chat.cannotPublic')))
              }
            >
              <span className="ga-ico">{match.isPublic ? <LuEyeOff /> : <LuEye />}</span>
              {t(match.isPublic ? 'game.hideGame' : 'game.showGame')}
            </button>
          </>
        ) : undefined
      }
      aside={pvp && me ? <MatchChat matchId={matchId} myId={me.id} opponentId={(iAmWhite ? match.blackId : match.whiteId) ?? ''} names={{ [match.whiteId]: match.whiteName, ...(match.blackId ? { [match.blackId]: match.blackName ?? '' } : {}) }} active={match.status === 'active'} /> : undefined}
      onRematch={
        // no rematch against a virtual opponent: the next search always finds someone new
        !virtualOpp && pvp && match.status === 'finished'
          ? () =>
              offerRematch(matchId)
                .then(() => toast('success', t('chat.rematchSent')))
                .catch((e) => toast('error', t(chatErrorKey(e instanceof SbError ? e.message : ''))))
          : undefined
      }
      banner={
        conn !== 'open' || sendTry > 0 ? (
          <div className="notice notice-warn" role="status">
            <LuWifiOff /> <span>{t(sendTry > 0 ? 'online.resending' : 'online.reconnecting')}</span>
          </div>
        ) : (
          clockNote
        )
      }
      overlay={
        achPop ? (
          <AchievementUnlocked items={achPop} onClose={() => setAchPop(null)} />
        ) : undefined
      }
    />
  );
}

/* ------------------------------ Game screen ------------------------------ */

interface ScreenProps {
  g: ReturnType<typeof useCheckers>;
  kind: GameKind;
  humanColor: Color;
  top: PlayerInfo;
  bottom: PlayerInfo;
  canRestart: boolean;
  canUndo: boolean;
  canHint: boolean;
  canDraw: boolean;
  onResign: () => void;
  onRestart: () => void;
  result: ResultInfo | null;
  onPlayAgain: () => void;
  onExit: () => void;
  banner?: ReactNode;
  serverThinking?: boolean;
  /** extra buttons in the controls card (online: draw offer, hide game) */
  extraControls?: ReactNode;
  /** chat / offers (online PvP) */
  aside?: ReactNode;
  onRematch?: () => void;
  /** dialogs owned by the caller (virtual rematch answer) */
  overlay?: ReactNode;
  /** per-player cosmetics of this game (undefined = my own cosmetics on both sides) */
  skin?: { cls: string; fx: { w?: string; b?: string } };
}

function GameScreen({ g, kind, humanColor, top, bottom, canRestart, canUndo, canHint, canDraw, onResign, onRestart, result, onPlayAgain, onExit, banner, serverThinking, extraControls, aside, onRematch, skin, overlay }: ScreenProps) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [confirm, setConfirm] = useState<null | 'resign' | 'restart' | 'draw'>(null);
  const [rules, setRules] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const histRef = useRef<HTMLOListElement>(null);
  const over = g.game.result.status !== 'playing';
  const counts = countPieces(g.game.board);
  const flipped = humanColor === 'b' && kind !== 'local';
  // DAMEO Pass: combo effects (own moves with 2+ captures) and the victory animation
  const { me } = useAuth();
  const worn = useWorn(me?.id);
  const lastRec = g.game.history[g.game.history.length - 1];
  const combo = useMemo(() => {
    const owned = (worn.combo ?? '').split(',');
    const n = lastRec?.captures.length ?? 0;
    if (!lastRec || n < 2 || (kind !== 'local' && lastRec.color !== humanColor)) return null;
    const tier = n >= 3 && owned.includes('cb-triple') ? 'triple' : owned.includes('cb-double') ? 'double' : null;
    return tier ? { from: lastRec.from, path: lastRec.path, captures: lastRec.captures, tier, key: `${g.game.history.length}-${lastRec.from}` } as const : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.game.history.length, worn.combo]);

  // DAMEO Pass XP of this game: pass XP when the game starts vs right after it ends
  const xpBefore = useRef<number | null>(null);
  const [gameXp, setGameXp] = useState<PassGain | null>(null);
  useEffect(() => {
    if (over) return;
    setGameXp(null);
    getPassRecent(120_000).then((p) => (xpBefore.current = p.earned ?? p.xp), () => undefined);
  }, [over]);
  useEffect(() => {
    if (!result || xpBefore.current === null) return;
    const before = xpBefore.current;
    const id = setTimeout(() => {
      getPass().then(
        (p) => {
          const xp = p.earned ?? p.xp;
          const lv = levelOf(xp);
          setGameXp({ n: Math.max(0, xp - before), lv: lv.level, left: lv.nextAt === null ? 0 : lv.nextAt - xp, capped: xp === before && kind !== 'local' && kind !== 'practice' });
        },
        () => undefined,
      );
    }, 500);
    return () => clearTimeout(id);
  }, [result]);

  useEffect(() => setResultOpen(true), [result]);
  useEffect(() => {
    histRef.current?.scrollTo({ top: histRef.current.scrollHeight });
  }, [g.game.history.length]);

  const ask = (kindOfAction: 'resign' | 'restart' | 'draw', fn: () => void) => () => {
    if (settings.confirmActions) setConfirm(kindOfAction);
    else fn();
  };
  const pairs = useMemo(() => {
    const out: Array<[string, string | undefined]> = [];
    for (let i = 0; i < g.game.history.length; i += 2) out.push([g.game.history[i].notation, g.game.history[i + 1]?.notation]);
    return out;
  }, [g.game.history]);

  const turnText = over
    ? t('game.over')
    : kind === 'local'
      ? t(g.game.turn === 'w' ? 'game.turnWhite' : 'game.turnBlack')
      : g.humanTurn
        ? t('game.yourTurn')
        : g.thinking || serverThinking
          ? t('game.thinking')
          : t('game.opponentTurn');

  const bar = (p: PlayerInfo, active: boolean, remaining: number) => (
    <div className={`player-bar ${active && !over ? 'player-active' : ''}`}>
      <Avatar name={p.name} seed={p.seed} size={40} userId={p.id} />
      <div className="player-info">
        <span className="player-name">
          {p.link ? <Link to={p.link} className="player-link">{p.name}</Link> : p.name}{' '}
          {!p.ai && p.tag && <span className="badge badge-demo">{p.tag}</span>}
        </span>
        <span className="muted small">
          <span className={`mini-piece ${p.color === 'w' ? 'mini-w' : 'mini-b'}`} /> {t(p.color === 'w' ? 'side.white' : 'side.black')}
          {p.rating !== undefined && ` · ${p.rating}`}
        </span>
      </div>
      {p.clock && (
        <div
          className={`clock ${p.clock.active ? 'clock-active' : ''} ${p.clock.warn ? 'clock-warn' : ''}`}
          role="timer"
          aria-label={p.clock.moveLeftMs !== null ? `${formatClock(p.clock.ms)} · ${t('game.moveTimer', { n: Math.ceil(p.clock.moveLeftMs / 1000) })}` : formatClock(p.clock.ms)}
        >
          <span className="clock-main">{formatClock(p.clock.ms)}</span>
          {p.clock.moveLeftMs !== null && <span className="clock-move">{Math.ceil(p.clock.moveLeftMs / 1000)}s</span>}
        </div>
      )}
      <div className="player-count" title={t('game.piecesLeft')}>
        <span className={`mini-piece ${p.color === 'w' ? 'mini-w' : 'mini-b'}`} />
        <strong>{remaining}</strong>
      </div>
    </div>
  );

  const showHistoryEmpty = pairs.length === 0;
  return (
    <div className="page game-page">
      <div className="game-top">
        {/* no "back" while the game runs: an accidental tap must never take a player out of a live game */}
        {over ? (
          <button className="game-back" onClick={onExit}>
            <LuArrowLeft /> {t('game.back')}
          </button>
        ) : (
          <span />
        )}
        <button className="icon-btn game-rules" onClick={() => setRules(true)} aria-label={t('rules.button')} title={t('rules.button')}>
          <LuBookOpen />
        </button>
      </div>
      {banner}
      <div className="game-layout">
        <div className="game-main">
          {bar(top, g.game.turn === top.color, top.color === 'w' ? counts.w : counts.b)}
          <Board
            board={g.game.board}
            ids={g.ids}
            flipped={flipped}
            selected={g.selected}
            targets={g.targets}
            pathMarks={g.prefix}
            mustMove={g.mustMove}
            hint={g.hint}
            lastMove={g.lastMove}
            showLegal={settings.showLegal || kind === 'practice'}
            disabled={over}
            shake={g.shake}
            onSquare={g.clickSquare}
            skin={skin?.cls}
            fx={skin?.fx}
            combo={combo}
          />
          {bar(bottom, g.game.turn === bottom.color, bottom.color === 'w' ? counts.w : counts.b)}
          <p className={`msg-line ${g.message?.tone === 'error' ? 'msg-error' : ''}`} role="status" aria-live="polite" key={g.message?.n ?? 0}>
            {g.message ? t(g.message.key) : ' '}
          </p>
        </div>

        <aside className="game-side">
          <div className={`turn-pill ${over ? 'turn-over' : ''}`}>
            {(g.thinking || serverThinking) && <LuLoader className="spin" />} {turnText}
          </div>
          <div className="game-actions">
            {canHint && (
              <button className="ga" onClick={g.askHint} disabled={over || !g.humanTurn || g.thinking}>
                <span className="ga-ico"><LuLightbulb /></span>
                {t('game.hint')}
              </button>
            )}
            {canUndo && (
              <button className="ga" onClick={g.undo} disabled={!g.canUndo}>
                <span className="ga-ico"><LuUndo2 /></span>
                {t('game.undo')}
              </button>
            )}
            {canDraw && (
              <button className="ga" onClick={ask('draw', g.drawByAgreement)} disabled={over}>
                <span className="ga-ico"><LuHandshake /></span>
                {t('game.draw')}
              </button>
            )}
            {canRestart && (
              <button className="ga" onClick={g.game.history.length === 0 ? onRestart : ask('restart', onRestart)}>
                <span className="ga-ico"><LuRotateCcw /></span>
                {t('game.restart')}
              </button>
            )}
            {extraControls}
            <button className="ga ga-danger" onClick={ask('resign', onResign)} disabled={over}>
              <span className="ga-ico"><LuFlag /></span>
              {t('game.resign')}
            </button>
          </div>
          <details className="game-moves">
            <summary>
              {t('game.moves')} <span className="game-moves-n">{g.game.history.length}</span>
            </summary>
            <ol className="history" ref={histRef} aria-label={t('game.moves')}>
              {showHistoryEmpty ? (
                <li className="muted small history-empty">{t('game.noMoves')}</li>
              ) : (
                pairs.map(([w, b], i) => (
                  <li key={i}>
                    <span className="hn">{i + 1}.</span>
                    <span className="hm">{w}</span>
                    <span className="hm">{b ?? ''}</span>
                  </li>
                ))
              )}
            </ol>
          </details>
        </aside>
      </div>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={t(confirm === 'restart' ? 'game.restartTitle' : confirm === 'draw' ? 'game.drawTitle' : 'game.resignTitle')}>
        <p className="muted">{t(confirm === 'restart' ? 'game.restartBody' : confirm === 'draw' ? 'game.drawBody' : kind === 'demo-rated' || kind === 'online' ? 'game.resignRatedBody' : 'game.resignBody')}</p>
        <div className="row-actions">
          <button
            className="btn btn-danger"
            onClick={() => {
              const c = confirm;
              setConfirm(null);
              if (c === 'resign') onResign();
              else if (c === 'restart') onRestart();
              else if (c === 'draw') g.drawByAgreement();
            }}
          >
            {t('common.confirm')}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
            {t('common.cancel')}
          </button>
        </div>
      </Modal>

      <RulesDialog open={rules} onClose={() => setRules(false)} />
      {aside}
      {overlay}
      {result && <ResultDialog passXp={gameXp} victory={worn.victory} open={resultOpen} onClose={() => setResultOpen(false)} result={result} onPlayAgain={onPlayAgain} onExit={onExit} kind={kind} onRematch={onRematch ? () => { setResultOpen(false); onRematch(); } : undefined} />}
      {over && !result && kind === 'online' && <div className="notice"><LuLoader className="spin" /> {t('online.finalizing')}</div>}
      {over && result && !resultOpen && (
        <div className="row-actions center">
          {onRematch && (
            <button className="btn btn-secondary" onClick={onRematch}>
              <LuRotateCcw /> {t('chat.rematch')}
            </button>
          )}
          <button className="btn btn-primary" onClick={onPlayAgain}>
            <LuSwords /> {t('game.playAgain')}
          </button>
        </div>
      )}
    </div>
  );
}

interface PassGain {
  n: number;
  lv: number;
  left: number;
  capped: boolean;
}
function ResultDialog({ open, onClose, result, onPlayAgain, onExit, kind, onRematch, victory, passXp }: { passXp?: PassGain | null; victory?: string; open: boolean; onClose: () => void; result: ResultInfo; onPlayAgain: () => void; onExit: () => void; kind: GameKind; onRematch?: () => void }) {
  const { t, num } = useI18n();
  const win = result.outcome === 'win';
  useEffect(() => {
    if (!open) return;
    haptic(win ? 'win' : 'error');
    playSound(result.outcome === 'win' ? (victory ? 'victory' : 'win') : result.outcome === 'loss' ? 'loss' : 'draw');
  }, [open, win]);
  const title = result.outcome === 'win' ? t('result.victory') : result.outcome === 'loss' ? t('result.defeat') : result.outcome === 'draw' ? t('result.drawn') : t(result.winnerColor === 'w' ? 'result.whiteWins' : 'result.blackWins');
  const hasRating = result.rated && result.before !== undefined && result.after !== undefined;
  const shown = useCountUp(result.before ?? 0, result.after ?? 0, 1200, hasRating);
  const delta = hasRating ? result.after! - result.before! : 0;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open && win && victory && <VictoryFx />}
      <div className={`result ${win ? 'result-win' : ''}`}>
        {win && <Confetti />}
        {kind === 'online' && result.rated && <FairPlayNotice delayMs={1200} />}
        <div className={`result-crown ${win ? 'result-crown-win' : ''}`}>
          <LuCrown />
        </div>
        <p className="muted">{result.reason}</p>
        {hasRating ? (
          <div className="rating-change" aria-live="polite">
            <div className="rc-number">{num(shown)}</div>
            <div className={`rc-delta ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-0'}`}>{delta > 0 ? `+${delta}` : delta}</div>
            {result.demo && <span className="badge badge-demo">{t('demo.localRating')}</span>}
          </div>
        ) : (
          <p className="muted small">{kind === 'online' && result.rated ? t('result.updating') : t('result.unrated')}</p>
        )}
        {result.coins !== undefined && <CoinReward coins={result.coins} win={win} moves={result.moves ?? 0} />}
        {passXp && (passXp.n > 0 || passXp.capped) && (
          <Link to="/pass" className="pass-xp-chip" onClick={onClose}>
            <b>{passXp.n > 0 ? t('pass.gameXp', { n: passXp.n }) : t('pass.gameXpCap')}</b>
            {passXp.left > 0 && <span>{t('pass.gameXpLv', { lv: passXp.lv, left: passXp.left })}</span>}
          </Link>
        )}
        <div className="row-actions center">
          {onRematch && (
            <button className="btn btn-secondary" onClick={onRematch}>
              <LuRotateCcw /> {t('chat.rematch')}
            </button>
          )}
          <button className="btn btn-primary" onClick={onPlayAgain}>
            <LuSwords /> {t('game.playAgain')}
          </button>
          <button className="btn btn-ghost" onClick={onExit}>
            {t('game.back')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "+20 DAMEO Coins" / "+10 DAMEO Coins" — only what the server credited; a short game shows why there is none. */
function CoinReward({ coins, win, moves }: { coins: number | null; win: boolean; moves: number }) {
  const { t, num } = useI18n();
  const shown = useCountUp(0, coins ?? 0, 900, (coins ?? 0) > 0);
  if (coins === null)
    return (
      <div className="coin-reward is-wait" aria-live="polite">
        <LuLoader className="spin" /> {t('reward.checking')}
      </div>
    );
  if (coins === 0) return <p className="coin-reward-none muted small">{t(moves < 12 ? 'reward.none' : 'reward.noneLimit')}</p>;
  return (
    <div className={`coin-reward ${win ? 'is-win' : 'is-loss'}`} aria-live="polite">
      <span className="coin-reward-ico" aria-hidden="true">🪙</span>
      <span className="coin-reward-main">
        <strong className="coin-reward-n">+{num(shown)}</strong>
        <span className="coin-reward-label">DAMEO Coins</span>
      </span>
      <span className="coin-reward-why small">{t(win ? 'reward.win' : 'reward.loss')}</span>
    </div>
  );
}
