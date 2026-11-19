import { useCallback, useEffect, useRef, useState } from 'react';
import { everyActive } from '../services/telegram.ts';
import { LuChevronLeft, LuChevronRight, LuCrown, LuSearch, LuTrendingUp, LuTrophy } from 'react-icons/lu';
import { levelOf } from '../services/levels.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { Delta, winRate } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { Link, navigate, useRoute } from '../router.tsx';
import { Tournaments } from './Tournaments.tsx';
import { isOnline } from '../services/demoData.ts';
import { fetchLeaderboard, subscribeLeaderboard, type LeaderboardPage, type RankedPlayer, type Scope } from '../services/leaderboard.ts';
import type { ConnectionState } from '../services/supabase.ts';

const PAGE_SIZE = 10;

type View = 'all' | 'top100' | 'tournaments';

export function Leaderboard({ initialTab }: { initialTab?: View } = {}) {
  const { t, num } = useI18n();
  const { me, mode, signedIn, friendIds } = useAuth();
  const { query } = useRoute();
  const qTab = query.get('tab');
  const view: View = initialTab ?? (qTab === 'tournaments' || qTab === 'top100' ? qTab : 'all');
  const scope: Scope = view === 'top100' ? 'top100' : 'all';
  const setView = (v: View) => navigate(v === 'all' ? '/leaderboard' : `/leaderboard?tab=${v}`);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<LeaderboardPage | null>(null);
  const [podium, setPodium] = useState<RankedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [conn, setConn] = useState<ConnectionState | null>(null);
  const [, tick] = useState(0);
  const seq = useRef(0);
  const meCardRef = useRef<HTMLDivElement>(null);
  const [meCardVisible, setMeCardVisible] = useState(true);
  useEffect(() => {
    const el = meCardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setMeCardVisible(e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  // debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input);
      setPage(0);
    }, 250);
    return () => clearTimeout(id);
  }, [input]);

  const needsAccount = false; // the friends scope moved out of the rating tabs

  const load = useCallback(
    async (silent: boolean) => {
      if (needsAccount) return;
      const my = ++seq.current;
      if (!silent) setLoading(true);
      setError(false);
      try {
        const ctx = { me, friendIds };
        const [pageData, top] = await Promise.all([fetchLeaderboard({ scope, search, page, pageSize: PAGE_SIZE }, ctx), fetchLeaderboard({ scope: 'all', search: '', page: 0, pageSize: 3 }, ctx)]);
        if (seq.current !== my) return;
        setData(pageData);
        setPodium(top.rows);
      } catch {
        if (seq.current === my) setError(true);
      } finally {
        if (seq.current === my) setLoading(false);
      }
    },
    [scope, search, page, me, friendIds, needsAccount],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // real-time: refetch quietly whenever the server reports a rating change
  const loadRef = useRef(load);
  loadRef.current = load;
  // a change matters if a shown player's rating moved, or someone else's rating now falls inside the shown range
  const shown = useRef<{ ids: Map<string, number>; min: number; max: number; top: boolean }>({ ids: new Map(), min: 0, max: Infinity, top: true });
  useEffect(() => {
    const rows = [...(data?.rows ?? []), ...podium];
    const r = rows.map((p) => p.rating);
    shown.current = { ids: new Map(rows.map((p) => [p.id, p.rating])), min: r.length ? Math.min(...r) : 0, max: r.length ? Math.max(...r) : Infinity, top: page === 0 };
  }, [data, podium, page]);
  useEffect(
    () =>
      subscribeLeaderboard(
        () => void loadRef.current(true),
        setConn,
        (p) => {
          const s = shown.current;
          const was = s.ids.get(p.id);
          return was !== undefined ? was !== p.rating : p.rating >= s.min && (s.top || p.rating <= s.max);
        },
      ),
    [],
  );

  // keep "updated x ago" and online dots fresh — only while the app is open
  useEffect(() => {
    const offTick = everyActive(() => tick((n) => n + 1), 15_000);
    const offLoad = everyActive(() => void loadRef.current(true), 60_000);
    return () => {
      offTick();
      offLoad();
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const live = mode === 'live';
  const status = !live ? (
    <span className="badge badge-demo">{t('lb.demoSnapshot')}</span>
  ) : conn === 'open' ? (
    <span className="live-pill"><span className="dot dot-on" /> {t('lb.live')}</span>
  ) : (
    <span className="live-pill live-pill-off"><span className="dot dot-off" /> {t('lb.reconnecting')}</span>
  );

  const tabs: Array<{ id: View; label: string }> = [
    { id: 'all', label: t('common.seeAll') },
    { id: 'top100', label: t('lb.top100') },
    { id: 'tournaments', label: t('daily.tab') },
  ];

  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  const meRow = data?.me ?? data?.rows.find((r) => r.id === me?.id) ?? null;
  const topPct = meRow && data?.total ? Math.max(1, Math.ceil((meRow.rank / data.total) * 100)) : null;
  return (
    <div className="page lb-page">
      <div className="lb-top">
        <h1 className="h1">{t('nav.leaderboard')}</h1>
        {status}
      </div>

      {meRow && signedIn && view !== 'tournaments' && (
        <div ref={meCardRef}>
          <MeCard p={meRow} total={data?.total ?? 0} topPct={topPct} ctxMe={me} friendIds={friendIds} />
        </div>
      )}

      <div className="tabs lb-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={view === x.id} className={`tab ${view === x.id ? 'tab-active' : ''}`} onClick={() => (setView(x.id), setPage(0))}>
            {x.label}
          </button>
        ))}
      </div>

      {view === 'tournaments' ? (
        <Tournaments embedded />
      ) : (
        <>
          {podium.length > 0 && !search && page === 0 && (
            <section className="lb-podium" aria-label={t('lb.podium')}>
              {order.map((p) => (
                <Link key={p.id} to={`/profile/${p.id}`} className={`lb-pod lb-pod-${p.rank}`}>
                  {p.rank === 1 && <LuCrown className="lb-pod-crown" aria-hidden="true" />}
                  <Avatar userId={p.id} name={p.username} seed={p.avatar} size={p.rank === 1 ? 74 : 58} ring={p.rank === 1 ? 'gold' : p.rank === 2 ? 'silver' : 'bronze'} />
                  <span className="lb-pod-name">{p.username}</span>
                  <span className="lb-pod-rating">{num(p.rating)}</span>
                  <span className="lb-pod-step">
                    <span className="lb-pod-n">{p.rank}</span>
                  </span>
                </Link>
              ))}
            </section>
          )}

          <label className="search lb-search">
            <LuSearch aria-hidden="true" />
            <span className="sr-only">{t('lb.search')}</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('lb.searchShort')} type="search" />
          </label>

          {loading && !data ? (
            <Spinner />
          ) : error ? (
            <ErrorState onRetry={() => load(false)} />
          ) : data && data.rows.length === 0 ? (
            <EmptyState title={t('lb.noResults')} />
          ) : (
            <>
              <ol className={`lb-cards ${loading ? 'is-loading' : ''}`}>
                {data?.rows
                  .filter((p) => search || page > 0 || p.rank > 3)
                  .map((p) => (
                    <li key={p.id}>
                      <LbRow p={p} meId={me?.id} />
                    </li>
                  ))}
              </ol>
              {totalPages > 1 && (
                <div className="pager lb-pager">
                  <button className="icon-btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label={t('common.prev')}>
                    <LuChevronLeft />
                  </button>
                  <span className="lb-pager-n">{t('common.pageOf', { page: page + 1, total: totalPages })}</span>
                  <button className="icon-btn" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label={t('common.next')}>
                    <LuChevronRight />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {meRow && signedIn && view !== 'tournaments' && !meCardVisible && (
        <button type="button" className="lb-mebar" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="lb-mebar-rank">#{num(meRow.rank)}</span>
          <Avatar userId={meRow.id} name={meRow.username} seed={meRow.avatar} size={30} />
          <span className="lb-mebar-name">{t('common.you')}</span>
          <strong>{num(meRow.rating)}</strong>
        </button>
      )}
    </div>
  );
}

/** "Where am I" card: rank, rating, top-%, and how many points to climb one place. */
function MeCard({ p, total, topPct, ctxMe, friendIds }: { p: RankedPlayer; total: number; topPct: number | null; ctxMe: any; friendIds: string[] }) {
  const { t, num } = useI18n();
  const [gap, setGap] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    if (p.rank <= 1) return;
    fetchLeaderboard({ scope: 'all', search: '', page: p.rank - 2, pageSize: 1 }, { me: ctxMe, friendIds }).then(
      (r) => on && r.rows[0] && setGap(Math.max(1, r.rows[0].rating - p.rating + 1)),
      () => undefined,
    );
    return () => {
      on = false;
    };
  }, [p.rank, p.rating]);
  const lv = levelOf(p.rating);
  return (
    <section className="lb-me" aria-label={t('lb.yourPosition')}>
      <div className="lb-me-left">
        <span className="lb-me-label">{t('lb.yourPosition')}</span>
        <span className="lb-me-rank">#{num(p.rank)}</span>
        <span className="lb-me-of">{t('lb.ofPlayers', { n: num(total) })}</span>
      </div>
      <div className="lb-me-right">
        <span className="lb-me-chip">
          <LuTrophy aria-hidden="true" /> {num(p.rating)}
        </span>
        <span className="lb-me-chip lb-me-chip-lv">{t('level.name', { n: lv.level })}</span>
        {topPct !== null && <span className="lb-me-chip lb-me-chip-pct">{t('lb.topPct', { n: topPct })}</span>}
      </div>
      <div className="lb-me-foot">
        <LuTrendingUp aria-hidden="true" />
        {p.rank <= 1 ? t('lb.isFirst') : gap !== null ? t('lb.toClimb', { n: gap, rank: p.rank - 1 }) : '…'}
      </div>
    </section>
  );
}

function LbRow({ p, meId }: { p: RankedPlayer; meId?: string }) {
  const { t, num } = useI18n();
  const mine = p.id === meId;
  return (
    <Link to={`/profile/${p.id}`} className={`lb-card ${mine ? 'lb-card-me' : ''}`}>
      <span className={`lb-card-rank ${p.rank <= 10 ? 'lb-card-rank-top' : ''}`}>{p.rank}</span>
      <Avatar name={p.username} seed={p.avatar} size={42} online={isOnline(p)} userId={p.id} />
      <span className="lb-card-main">
        <span className="lb-card-name">
          {p.username}
          {mine && <span className="badge badge-you">{t('common.you')}</span>}
        </span>
        <span className="lb-card-sub">
          {t('level.short', { n: levelOf(p.rating).level })} · {winRate(p.wins, p.losses, p.draws)}% {t('lb.winsShort')}
        </span>
      </span>
      <span className="lb-card-end">
        <strong>{num(p.rating)}</strong>
        <Delta value={p.lastDelta} />
      </span>
    </Link>
  );
}
