import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LuArrowLeft, LuBookOpen, LuCrown, LuFlag, LuHandshake, LuLightbulb, LuLoader, LuRotateCcw, LuSwords, LuTimer, LuUndo2, LuWifiOff } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { Difficulty } from '../bot/ai.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Board } from '../components/Board.tsx';
import { Confetti } from '../components/Confetti.tsx';
import { Modal } from '../components/Modal.tsx';
import { RulesDialog } from '../components/RulesDialog.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCountUp } from '../hooks/useCountUp.ts';
import { useCheckers, type GameConfig, type GameKind } from '../hooks/useCheckers.ts';
import { countPieces, type Color, type GameResult } from '../engine/index.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { DEMO_PLAYERS } from '../services/demoData.ts';
import { clockView, formatClock, GRACE_MS } from '../services/clock.ts';
import { claimTimeout, getMatch, getMoves, resignOnline, startBotMatch, submitMove, toLocalMs, watchMatch, type OnlineMatch } from '../services/online.ts';
import { haptic, tg } from '../services/telegram.ts';
import { SbError } from '../services/supabase.ts';
import type { ConnectionState } from '../services/supabase.ts';
import { useSettings } from '../settings/SettingsProvider.tsx';
import { botLevelFor } from './Play.tsx';

/* ------------------------------------------------------------------ */

interface PlayerInfo {
  name: string;
  rating?: number;
  seed?: string;
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
  const bottom: PlayerInfo = { name: kind === 'local' ? t('game.player1') : (me?.username ?? t('common.you')), rating: kind === 'local' ? undefined : me?.rating, seed: me?.avatar, color: humanColor };

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
    />
  );
}

/* ------------------------------ Online games ------------------------------ */

function OnlineGame({ matchId }: { matchId: string }) {
  const { t } = useI18n();
  const { me, matches, refresh } = useAuth();
  const { toast } = useToast();
  const [match, setMatch] = useState<OnlineMatch | null>(null);
  const [error, setError] = useState(false);
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [result, setResult] = useState<ResultInfo | null>(null);
  const humanColor: Color = match && me && match.blackId === me.id ? 'b' : 'w';
  const cfg: GameConfig = useMemo(() => ({ kind: 'online', humanColor }), [humanColor]);

  const resync = useCallback(async (loadMoves: (m: Array<{ from: number; path: number[] }>) => void) => {
    const moves = await getMoves(matchId);
    loadMoves(moves);
  }, [matchId]);

  const [waitingServer, setWaitingServer] = useState(false);
  const g = useCheckers(cfg, {
    onHumanMove: async (mv) => {
      setWaitingServer(true);
      try {
        const r = await submitMove(matchId, mv.from, mv.path);
        if (!r.ok) throw new Error(r.error);
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
        // Server bot reply comes back in the same response (realtime delivers it too; the ply check de-duplicates).
        if (r.bot && gRef.current.game.history.length === r.bot.ply) gRef.current.applyRemote(r.bot.from, r.bot.path);
      } catch (e) {
        // Say exactly why the server refused the move, then re-sync the board from the server's copy.
        const code = e instanceof SbError ? e.message : e instanceof TypeError ? 'network' : 'server';
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
        setWaitingServer(false);
      }
    },
  });
  const gRef = useRef(g);
  gRef.current = g;

  const load = useCallback(async () => {
    try {
      setError(false);
      const m = await getMatch(matchId);
      if (!m) return setError(true);
      setMatch(m);
      await resync(gRef.current.loadMoves);
    } catch {
      setError(true);
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
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);
  const view = match?.clock ? clockView(match.clock, match.status === 'active' ? now : match.clock.turnStartedAt) : null;
  // the side to move is out of time → ask the server to end the game (either player may ask; the server re-checks)
  const claimed = useRef(-1);
  useEffect(() => {
    if (!view || !match?.clock || match.status !== 'active') return;
    if (now < view.deadline + GRACE_MS + 400 || claimed.current === match.clock.moveCount) return;
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
  const lowWarned = useRef(-1);
  useEffect(() => {
    if (!view || !match?.clock || match.status !== 'active' || view.side !== humanColor) return;
    if (view.moveLeftMs <= 10_000 && view.moveLeftMs > 0 && lowWarned.current !== match.clock.moveCount) {
      lowWarned.current = match.clock.moveCount;
      haptic('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  useEffect(() => {
    void load();
    return watchMatch(matchId, {
      onMove: (mv) => {
        const have = gRef.current.game.history.length;
        if (mv.ply === have) gRef.current.applyRemote(mv.from, mv.path);
        else if (mv.ply > have) void resync(gRef.current.loadMoves).catch(() => {}); // missed a move while offline
      },
      onMatch: (m) => setMatch(m),
      onStatus: (s) => {
        setConn(s);
        if (s === 'open') void load(); // refetch after every (re)connect
      },
    });
  }, [matchId, load, resync]);

  // finalised on the server → show the result using the server's verdict
  const shown = useRef(false);
  useEffect(() => {
    if (!match || match.status !== 'finished' || shown.current || !match.blackId) return;
    shown.current = true;
    const winnerColor: Color | null = match.result === 'white' ? 'w' : match.result === 'black' ? 'b' : null;
    if (g.game.result.status === 'playing') g.finishExternal(winnerColor, match.reason === 'resign' ? 'resign' : 'no-moves');
    const outcome = winnerColor === null ? 'draw' : winnerColor === humanColor ? 'win' : 'loss';
    const reason = match.timeoutKind
      ? t(match.timeoutKind === 'move' ? 'reason.timeoutMove' : 'reason.timeoutClock')
      : t(match.reason === 'resign' ? 'reason.resign' : winnerColor ? 'reason.no-moves' : 'reason.agreement');
    void refresh().then(() => {
      setResult({ outcome, winnerColor, reason, rated: match.rated, demo: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);

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
  const opp = match.vsBot
    ? { name: `${t('game.botName')} · ${t(`bot.${match.botLevel ?? 'medium'}` as 'bot.easy')}`, rating: undefined, tag: t('game.botTag') }
    : { name: (iAmWhite ? match.blackName : match.whiteName) ?? t('quick.opponent'), rating: (iAmWhite ? match.blackRating : match.whiteRating) ?? undefined };
  const clockFor = (c: Color): PlayerInfo['clock'] => {
    if (!view) return undefined;
    const active = match.status === 'active' && view.side === c;
    const moveLeftMs = active ? view.moveLeftMs : null;
    return { ms: c === 'w' ? view.whiteMs : view.blackMs, active, moveLeftMs, warn: active && view.moveLeftMs <= 10_000 };
  };
  const topColor: Color = iAmWhite ? 'b' : 'w';
  const top: PlayerInfo = { ...opp, color: topColor, clock: clockFor(topColor) };
  const bottom: PlayerInfo = { name: me.username, rating: me.rating, seed: me.avatar, color: humanColor, clock: clockFor(humanColor) };
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
      onResign={() => resignOnline(matchId).catch(() => toast('error', t('online.resignFailed')))}
      onRestart={() => {}}
      result={finalResult}
      onPlayAgain={
        match.vsBot
          ? () =>
              startBotMatch(match.botLevel ?? 'random')
                .then((r) => navigate(`/game?online=${r.match_id}`))
                .catch(() => toast('error', t('bot.startFailed')))
          : () => navigate('/play?mode=quick')
      }
      onExit={() => navigate('/play')}
      serverThinking={waitingServer && match.vsBot}
      banner={
        conn !== 'open' ? (
          <div className="notice notice-warn" role="status">
            <LuWifiOff /> <span>{t('online.reconnecting')}</span>
          </div>
        ) : (
          clockNote
        )
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
}

function GameScreen({ g, kind, humanColor, top, bottom, canRestart, canUndo, canHint, canDraw, onResign, onRestart, result, onPlayAgain, onExit, banner, serverThinking }: ScreenProps) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [confirm, setConfirm] = useState<null | 'resign' | 'restart' | 'draw'>(null);
  const [rules, setRules] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const histRef = useRef<HTMLOListElement>(null);
  const over = g.game.result.status !== 'playing';
  const counts = countPieces(g.game.board);
  const flipped = humanColor === 'b' && kind !== 'local';

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
      <Avatar name={p.name} seed={p.seed} size={40} />
      <div className="player-info">
        <span className="player-name">
          {p.name} {p.tag && <span className="badge badge-demo">{p.tag}</span>}
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
      <button className="link-btn back-link" onClick={onExit}>
        <LuArrowLeft /> {t('game.back')}
      </button>
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
          />
          {bar(bottom, g.game.turn === bottom.color, bottom.color === 'w' ? counts.w : counts.b)}
          <p className={`msg-line ${g.message?.tone === 'error' ? 'msg-error' : ''}`} role="status" aria-live="polite" key={g.message?.n ?? 0}>
            {g.message ? t(g.message.key) : ' '}
          </p>
        </div>

        <aside className="game-side card">
          <div className={`turn-pill ${over ? 'turn-over' : ''}`}>
            {(g.thinking || serverThinking) && <LuLoader className="spin" />} {turnText}
          </div>
          <h3 className="side-title">{t('game.moves')}</h3>
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
          <div className="controls">
            {canHint && (
              <button className="btn btn-secondary" onClick={g.askHint} disabled={over || !g.humanTurn || g.thinking}>
                <LuLightbulb /> {t('game.hint')}
              </button>
            )}
            {canUndo && (
              <button className="btn btn-secondary" onClick={g.undo} disabled={!g.canUndo}>
                <LuUndo2 /> {t('game.undo')}
              </button>
            )}
            {canDraw && (
              <button className="btn btn-secondary" onClick={ask('draw', g.drawByAgreement)} disabled={over}>
                <LuHandshake /> {t('game.draw')}
              </button>
            )}
            {canRestart && (
              <button className="btn btn-secondary" onClick={g.game.history.length === 0 ? onRestart : ask('restart', onRestart)}>
                <LuRotateCcw /> {t('game.restart')}
              </button>
            )}
            <button className="btn btn-danger" onClick={ask('resign', onResign)} disabled={over}>
              <LuFlag /> {t('game.resign')}
            </button>
            <button className="btn btn-ghost" onClick={() => setRules(true)}>
              <LuBookOpen /> {t('rules.button')}
            </button>
          </div>
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
      {result && <ResultDialog open={resultOpen} onClose={() => setResultOpen(false)} result={result} onPlayAgain={onPlayAgain} onExit={onExit} kind={kind} />}
      {over && !result && kind === 'online' && <div className="notice"><LuLoader className="spin" /> {t('online.finalizing')}</div>}
      {over && result && !resultOpen && (
        <div className="row-actions center">
          <button className="btn btn-primary" onClick={onPlayAgain}>
            <LuSwords /> {t('game.playAgain')}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultDialog({ open, onClose, result, onPlayAgain, onExit, kind }: { open: boolean; onClose: () => void; result: ResultInfo; onPlayAgain: () => void; onExit: () => void; kind: GameKind }) {
  const { t, num } = useI18n();
  const win = result.outcome === 'win';
  useEffect(() => {
    if (open) haptic(win ? 'win' : 'error');
  }, [open, win]);
  const title = result.outcome === 'win' ? t('result.victory') : result.outcome === 'loss' ? t('result.defeat') : result.outcome === 'draw' ? t('result.drawn') : t(result.winnerColor === 'w' ? 'result.whiteWins' : 'result.blackWins');
  const hasRating = result.rated && result.before !== undefined && result.after !== undefined;
  const shown = useCountUp(result.before ?? 0, result.after ?? 0, 1200, hasRating);
  const delta = hasRating ? result.after! - result.before! : 0;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={`result ${win ? 'result-win' : ''}`}>
        {win && <Confetti />}
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
        <div className="row-actions center">
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
