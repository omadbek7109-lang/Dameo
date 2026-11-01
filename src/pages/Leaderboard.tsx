import { useCallback, useEffect, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCrown, LuSearch } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar, LevelBadge } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { DemoNotice, Delta, SignInPrompt, winRate } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { isOnline } from '../services/demoData.ts';
import { fetchLeaderboard, subscribeLeaderboard, type LeaderboardPage, type RankedPlayer, type Scope } from '../services/leaderboard.ts';
import type { ConnectionState } from '../services/supabase.ts';

const PAGE_SIZE = 10;

export function Leaderboard() {
  const { t, num, relative } = useI18n();
  const { me, mode, signedIn, friendIds } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
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

  // debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input);
      setPage(0);
    }, 250);
    return () => clearTimeout(id);
  }, [input]);

  const needsAccount = mode === 'live' && scope === 'friends' && !signedIn;

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
  useEffect(() => subscribeLeaderboard(() => void loadRef.current(true), setConn), []);

  // keep "updated x ago" fresh
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
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

  const tabs: Array<{ id: Scope; label: string }> = [
    { id: 'all', label: t('lb.all') },
    { id: 'friends', label: t('nav.friends') },
    { id: 'top100', label: t('lb.top100') },
  ];

  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">{t('nav.leaderboard')}</h1>
          <p className="muted">{t('lb.sub')}</p>
        </div>
        <div className="updated">
          {status}
          {data && <span className="muted small">{t('lb.updated', { when: relative(data.updatedAt) })}</span>}
        </div>
      </div>
      <DemoNotice text={t('demo.lbNotice')} />

      {podium.length > 0 && (
        <section className="podium" aria-label={t('lb.podium')}>
          {order.map((p) => (
            <Link key={p.id} to={`/profile/${p.id}`} className={`podium-card podium-${p.rank}`}>
              <span className="podium-crown">{p.rank === 1 && <LuCrown />}</span>
              <Avatar name={p.username} seed={p.avatar} size={p.rank === 1 ? 76 : 60} ring={p.rank === 1 ? 'gold' : p.rank === 2 ? 'silver' : 'bronze'} />
              <span className="podium-name">{p.username}</span>
              <LevelBadge rating={p.rating} label={(n) => t('level.short', { n })} />
              <span className="podium-rating">{num(p.rating)}</span>
              <span className="podium-rank">{p.rank}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} role="tab" aria-selected={scope === x.id} className={`tab ${scope === x.id ? 'tab-active' : ''}`} onClick={() => (setScope(x.id), setPage(0))}>
              {x.label}
            </button>
          ))}
        </div>
        <label className="search">
          <LuSearch aria-hidden="true" />
          <span className="sr-only">{t('lb.search')}</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('lb.search')} type="search" />
        </label>
      </div>

      {data?.me && !data.rows.some((r) => r.id === data.me!.id) && (
        <div className="my-pos">
          <span className="muted small">{t('lb.yourPosition')}</span>
          <LbRow p={data.me} meId={me?.id} />
        </div>
      )}

      {needsAccount ? (
        <SignInPrompt text={t('lb.friendsNeedAccount')} />
      ) : loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState onRetry={() => load(false)} />
      ) : data && data.rows.length === 0 ? (
        <EmptyState title={scope === 'friends' && !search ? t('lb.noFriends') : t('lb.noResults')} hint={scope === 'friends' && !search ? t('lb.noFriendsHint') : undefined} />
      ) : (
        <>
          <div className="lb-head" aria-hidden="true">
            <span>#</span>
            <span>{t('lb.player')}</span>
            <span className="r">{t('common.rating')}</span>
            <span className="r hide-sm">{t('common.wins')}</span>
            <span className="r hide-sm">{t('common.games')}</span>
            <span className="r">{t('common.winRate')}</span>
          </div>
          <ol className={`lb-list ${loading ? 'is-loading' : ''}`}>
            {data?.rows.map((p) => (
              <li key={p.id}>
                <LbRow p={p} meId={me?.id} />
              </li>
            ))}
          </ol>
          <div className="pager">
            <button className="icon-btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label={t('common.prev')}>
              <LuChevronLeft />
            </button>
            <span className="muted">{t('common.pageOf', { page: page + 1, total: totalPages })}</span>
            <button className="icon-btn" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label={t('common.next')}>
              <LuChevronRight />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LbRow({ p, meId }: { p: RankedPlayer; meId?: string }) {
  const { t, num } = useI18n();
  const games = p.wins + p.losses + p.draws;
  return (
    <Link to={`/profile/${p.id}`} className={`lb-row ${p.id === meId ? 'lb-me' : ''}`}>
      <span className={`rank-chip ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}>{p.rank}</span>
      <span className="lb-player">
        <Avatar name={p.username} seed={p.avatar} size={36} online={isOnline(p)} />
        <span className="lb-name">
          <span className="row-title">
            {p.username}
            <LevelBadge rating={p.rating} label={(n) => t('level.short', { n })} />
            {p.id === meId && <span className="badge badge-you">{t('common.you')}</span>}
            {p.demo && p.id !== meId && <span className="badge badge-demo">{t('demo.badge')}</span>}
          </span>
          <span className="row-sub">{isOnline(p) ? t('common.online') : t('common.offline')}</span>
        </span>
      </span>
      <span className="r lb-rating">
        <strong>{num(p.rating)}</strong>
        <Delta value={p.lastDelta} />
      </span>
      <span className="r hide-sm">{num(p.wins)}</span>
      <span className="r hide-sm">{num(games)}</span>
      <span className="r">{winRate(p.wins, p.losses, p.draws)}%</span>
    </Link>
  );
}
