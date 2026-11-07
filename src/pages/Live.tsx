import { subscribeChanges } from '../services/supabase.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuArchive, LuClock, LuEye, LuRadio, LuSparkles, LuSwords } from 'react-icons/lu';
import { Avatar } from '../components/Avatar.tsx';
import { Board } from '../components/Board.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { replay } from '../engine/index.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { featuredGames, liveList, liveStats, type FeaturedGame, type LiveGame } from '../services/live.ts';
import { tg, appActive, everyActive } from '../services/telegram.ts';

const noop = () => {};
/** small static board for a list card */
export function PositionBoard({ moves }: { moves: Array<[number, number[]]> | Array<{ from: number; path: number[] }> }) {
  const st = useMemo(() => {
    const list = (moves as any[]).map((m) => (Array.isArray(m) ? { from: m[0], path: m[1] } : m));
    return replay(list).state;
  }, [moves]);
  const ids = useMemo(() => st.board.map((c, i) => (c !== 0 ? i : -1)), [st]);
  const last = st.history.length ? st.history[st.history.length - 1] : null;
  return (
    <div className="pos-board" aria-hidden="true">
      <Board board={st.board} ids={ids} flipped={false} selected={null} targets={[]} pathMarks={[]} mustMove={[]} hint={null}
        lastMove={last ? { from: last.from, to: last.path[last.path.length - 1] } : null} showLegal={false} disabled shake={0} onSquare={noop} skin="" />
    </div>
  );
}

export const modeLabel = (t: (k: TKey, p?: Record<string, string | number>) => string, g: { vs_bot?: boolean; bot_level?: string | null; time_control: number | null; black_virtual?: boolean }) =>
  g.vs_bot && !g.black_virtual ? `${t('game.botName')} · ${t(`bot.${g.bot_level ?? 'medium'}` as TKey)}` : g.time_control ? t('tc.minutes', { n: g.time_control / 60 }) : t('live.untimed');

const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Live games now + notable finished games. */
export function Live() {
  const { t, num } = useI18n();
  const route = useRoute();
  const [tab, setTab] = useState<'live' | 'featured'>(route.query.get('tab') === 'featured' ? 'featured' : 'live');
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [featured, setFeatured] = useState<FeaturedGame[] | null>(null);
  const [stats, setStats] = useState<{ games: number; viewers: number } | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      if (tab === 'live') {
        const [g, s] = await Promise.all([liveList(), liveStats()]);
        setGames(g);
        setStats(s);
      } else setFeatured(await featuredGames());
      setError(false);
    } catch {
      setError(true);
    }
  }, [tab]);
  // realtime: a game starting / finishing refreshes the list at once (debounced); a slow poll is the fallback
  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout> | null = null;
    const sub = subscribeChanges('public:live-list', [{ table: 'matches', event: 'INSERT' }, { table: 'matches', event: 'UPDATE', filter: 'status=neq.active' }], (e) => {
      const r = (e.record ?? {}) as { status?: string };
      // moves in running games are filtered out on the server (status=neq.active); this is a second guard
      if (e.type === 'UPDATE' && r.status === 'active') return;
      if (t) clearTimeout(t);
      t = setTimeout(() => appActive() && void load(), 800);
    });
    const id = setInterval(() => appActive() && void load(), 30_000);
    const onWake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      sub.close();
      if (t) clearTimeout(t);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
  }, [load]);
  useEffect(() => {
    return everyActive(() => setNow(Date.now()), 1000);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">
            <LuRadio /> {t('live.title')}
          </h1>
          <p className="muted">{t('live.sub')}</p>
        </div>
        <Link to="/archive" className="btn btn-secondary btn-sm">
          <LuArchive /> {t('archive.title')}
        </Link>
      </div>
      {stats && tab === 'live' && (
        <div className="live-stats">
          <span>
            <span className="wk-dot" aria-hidden="true" /> {t('live.games', { n: num(stats.games) })}
          </span>
          <span>
            <LuEye /> {t('live.viewers', { n: num(stats.viewers) })}
          </span>
        </div>
      )}
      <div className="chip-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'live'} className={`chip-tab ${tab === 'live' ? 'chip-tab-on' : ''}`} onClick={() => setTab('live')}>
          <LuRadio /> {t('live.tabLive')}
        </button>
        <button role="tab" aria-selected={tab === 'featured'} className={`chip-tab ${tab === 'featured' ? 'chip-tab-on' : ''}`} onClick={() => setTab('featured')}>
          <LuSparkles /> {t('live.tabFeatured')}
        </button>
      </div>
      {error && !(tab === 'live' ? games : featured) ? (
        <ErrorState onRetry={load} />
      ) : tab === 'live' ? (
        !games ? (
          <Spinner />
        ) : games.length === 0 ? (
          <EmptyState title={t('live.empty')} action={<Link to="/play?mode=quick" className="btn btn-primary"><LuSwords /> {t('mode.quick')}</Link>} />
        ) : (
          <div className="live-grid">
            {games.map((g) => (
              <Link key={g.id} to={`/watch?m=${g.id}`} className="card live-card">
                <PositionBoard moves={g.moves} />
                <div className="live-players">
                  <span className="live-p">
                    <Avatar name={g.white_name} seed={g.white_avatar} size={22} /> <strong>{g.white_name}</strong> <span className="muted">{g.white_rating}</span>
                  </span>
                  <span className="live-p">
                    <Avatar name={g.black_name ?? '?'} seed={g.black_avatar ?? undefined} size={22} /> <strong>{g.black_name}</strong> <span className="muted">{g.black_rating}</span>
                  </span>
                </div>
                <div className="live-meta muted small">
                  <span className="badge">{modeLabel(t, g)}</span>
                  <span>
                    <LuClock /> {dur(now - Date.parse(g.started_at))}
                  </span>
                  <span>
                    <LuEye /> {g.viewers}
                  </span>
                  <span>
                    {g.move_count} {t('live.moves')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : !featured ? (
        <Spinner />
      ) : featured.length === 0 ? (
        <EmptyState title={t('live.featuredEmpty')} />
      ) : (
        <ul className="admin-list">
          {featured.map((g) => (
            <li key={g.id}>
              <Link to={`/watch?m=${g.id}`} className="admin-row">
                <span className="admin-row-main">
                  <strong>
                    {g.white_name} ({g.white_rating}) — {g.black_name} ({g.black_rating})
                  </strong>
                  <span className="muted small">
                    {g.result === 'draw' ? t('result.drawn') : g.result === 'white' ? t('result.whiteWins') : t('result.blackWins')} · {g.move_count} {t('live.moves')}
                  </span>
                </span>
                <LuSparkles />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
