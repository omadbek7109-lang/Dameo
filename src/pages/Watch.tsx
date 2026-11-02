import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuArrowLeft, LuChevronFirst, LuChevronLast, LuChevronLeft, LuChevronRight, LuEye, LuFlag, LuRadio } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Board } from '../components/Board.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { EmptyState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { countPieces, replay, type Color } from '../engine/index.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { clockView, formatClock } from '../services/clock.ts';
import { chatErrorKey, liveChatRecent, liveChatSend, livePing, watchLiveChat, type ChatMsg } from '../services/live.ts';
import { getMatch, getMoves, watchMatch, type OnlineMatch, type OnlineMove } from '../services/online.ts';
import { reportCreate } from '../services/shop.ts';
import { SbError } from '../services/supabase.ts';
import { playSound } from '../services/sound.ts';
import { tg } from '../services/telegram.ts';
import { modeLabel } from './Live.tsx';

const noop = () => {};

/** Spectator view (live, realtime, read-only) and replay of finished games, with the spectators' chat. */
export function Watch() {
  const { t, num } = useI18n();
  const route = useRoute();
  const id = route.query.get('m') ?? '';
  const { me, signedIn } = useAuth();
  const { toast } = useToast();
  const [match, setMatch] = useState<OnlineMatch | null>(null);
  const [moves, setMoves] = useState<OnlineMove[]>([]);
  const [missing, setMissing] = useState(false);
  const [idx, setIdx] = useState<number | null>(null); // null = follow the live position
  const [viewers, setViewers] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await getMatch(id);
      if (!m) return setMissing(true);
      setMatch(m);
      setMoves(await getMoves(id));
    } catch {
      setMissing(true);
    }
  }, [id]);
  const loadChat = useCallback(async () => {
    try {
      setChat((await liveChatRecent(id)).reverse());
    } catch {
      /* chat is optional */
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadChat();
    // moves + status in realtime; new chat lines in realtime (re-read with names, debounced)
    const stopMatch = watchMatch(id, {
      onMove: (mv) => {
        setMoves((cur) => (cur.some((x) => x.ply === mv.ply) ? cur : [...cur, mv].sort((a, b) => a.ply - b.ply)));
        playSound('move');
      },
      onMatch: (m) => setMatch(m),
      onStatus: (s) => s === 'open' && void load(),
    });
    let tmr: ReturnType<typeof setTimeout> | undefined;
    const stopChat = watchLiveChat(id, () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => void loadChat(), 250);
    });
    const onWake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      stopMatch();
      stopChat();
      clearTimeout(tmr);
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
  }, [id, load, loadChat]);

  const isPlayer = !!me && !!match && (me.id === match.whiteId || me.id === match.blackId);
  const active = match?.status === 'active';
  // a player watching their own running game belongs on the game screen
  useEffect(() => {
    if (isPlayer && active) navigate(`/game?online=${id}`);
  }, [isPlayer, active, id]);

  // viewer heartbeat (spectators of running games only); stops when the game ends or the page closes
  useEffect(() => {
    if (!match || !active || isPlayer) return;
    const ping = () => livePing(id).then((r) => setViewers(r.viewers)).catch(() => {});
    void ping();
    const t2 = setInterval(() => document.visibilityState === 'visible' && void ping(), 20_000);
    return () => clearInterval(t2);
  }, [match?.id, active, isPlayer, id]);
  useEffect(() => {
    if (!active) return;
    const t3 = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t3);
  }, [active]);

  const shown = idx === null ? moves.length : Math.min(idx, moves.length);
  const st = useMemo(() => replay(moves.slice(0, shown)).state, [moves, shown]);
  const ids = useMemo(() => st.board.map((c, i) => (c !== 0 ? i : -1)), [st]);
  const last = shown > 0 ? moves[shown - 1] : null;
  const counts = countPieces(st.board);
  const view = match?.clock ? clockView(match.clock, active ? now : match.clock.turnStartedAt) : null;

  if (missing) return <div className="page"><EmptyState title={t('watch.missing')} action={<button className="btn btn-primary" onClick={() => navigate('/live')}>{t('live.title')}</button>} /></div>;
  if (!match) return <div className="page"><Spinner /></div>;

  const bar = (color: Color) => {
    const white = color === 'w';
    const name = (white ? match.whiteName : match.blackName) ?? '—';
    const rating = white ? match.whiteRating : match.blackRating;
    const ms = view ? (white ? view.whiteMs : view.blackMs) : null;
    const on = active && st.turn === color;
    return (
      <div className={`player-bar ${on ? 'player-active' : ''}`}>
        <Avatar name={name} size={36} />
        <div className="player-info">
          <span className="player-name">{name}</span>
          <span className="muted small">
            <span className={`mini-piece ${white ? 'mini-w' : 'mini-b'}`} /> {t(white ? 'side.white' : 'side.black')}
            {rating ? ` · ${rating}` : ''}
          </span>
        </div>
        {ms !== null && (
          <div className={`clock ${on ? 'clock-active' : ''}`}>
            <span className="clock-main">{formatClock(ms)}</span>
          </div>
        )}
        <div className="player-count">
          <span className={`mini-piece ${white ? 'mini-w' : 'mini-b'}`} />
          <strong>{white ? counts.w : counts.b}</strong>
        </div>
      </div>
    );
  };

  const resultText = match.status === 'finished'
    ? `${match.result === 'draw' ? t('result.drawn') : match.result === 'white' ? t('result.whiteWins') : t('result.blackWins')}${match.timeoutKind ? ` · ${t(match.timeoutKind === 'move' ? 'reason.timeoutMove' : 'reason.timeoutClock')}` : ''}`
    : null;

  return (
    <div className="page game-page watch-page">
      <button className="link-btn back-link" onClick={() => navigate('/live')}>
        <LuArrowLeft /> {t('live.title')}
      </button>
      <div className="watch-head">
        {active ? (
          <span className="wk-live">
            <span className="wk-dot" aria-hidden="true" /> {t('weekly.live')}
          </span>
        ) : (
          <span className="badge">{t('watch.replay')}</span>
        )}
        <span className="badge">{modeLabel(t, { vs_bot: match.vsBot, bot_level: match.botLevel, time_control: match.clock?.timeControl ?? null })}</span>
        {active && (
          <span className="muted small">
            <LuEye /> {num(viewers)}
          </span>
        )}
      </div>
      <div className="game-layout">
        <div className="game-main">
          {bar('b')}
          <Board board={st.board} ids={ids} flipped={false} selected={null} targets={[]} pathMarks={[]} mustMove={[]} hint={null}
            lastMove={last ? { from: last.from, to: last.path[last.path.length - 1] } : null} showLegal={false} disabled shake={0} onSquare={noop} />
          {bar('w')}
          {resultText && <p className="watch-result">{resultText}</p>}
          <div className="watch-steps" role="group" aria-label={t('watch.steps')}>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(0)} disabled={shown === 0} aria-label={t('watch.first')}>
              <LuChevronFirst />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(Math.max(0, shown - 1))} disabled={shown === 0} aria-label={t('watch.prev')}>
              <LuChevronLeft />
            </button>
            <span className="small muted">
              {shown} / {moves.length}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(shown + 1 >= moves.length ? null : shown + 1)} disabled={shown >= moves.length} aria-label={t('watch.next')}>
              <LuChevronRight />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(null)} disabled={idx === null} aria-label={t('watch.last')}>
              {active ? <LuRadio /> : <LuChevronLast />}
            </button>
          </div>
        </div>
      </div>
      {!isPlayer || !active ? (
        <ChatPanel
          title={t('chat.liveTitle')}
          messages={chat}
          myId={me?.id ?? null}
          open={chatOpen}
          setOpen={setChatOpen}
          canWrite={signedIn && !(isPlayer && active)}
          onSend={async (kind, body) => {
            try {
              await liveChatSend(id, kind, body);
              await loadChat();
            } catch (e) {
              toast('error', t(chatErrorKey(e instanceof SbError ? e.message : '')));
              throw e;
            }
          }}
          headerExtra={
            signedIn ? (
              <button
                className="icon-btn"
                aria-label={t('chat.report')}
                onClick={async () => {
                  try {
                    await reportCreate('chat', `Live chat report for game ${id}`, null, id);
                    toast('success', t('report.sent'));
                  } catch {
                    toast('error', t('report.failed'));
                  }
                }}
              >
                <LuFlag />
              </button>
            ) : null
          }
        />
      ) : null}
    </div>
  );
}

export const reasonKeyOf = (r: string | null): TKey => (r === 'resign' ? 'reason.resign' : r === 'agreement' ? 'reason.agreement' : 'reason.no-moves');
