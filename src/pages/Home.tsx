import { LuBot, LuGraduationCap, LuRadio, LuSwords, LuUsers } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar, LevelBadge } from '../components/Avatar.tsx';
import { levelOf } from '../services/levels.ts';
import { HeroBoard } from '../components/HeroBoard.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { DemoNotice, Delta, SectionHead, SeeAll, winRate } from '../components/ui.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useI18n } from '../i18n/index.tsx';
import { backendConfigured } from '../services/config.ts';
import { demoLiveMatches, isOnline } from '../services/demoData.ts';
import { fetchLeaderboard, onlineCount, recentlyActive } from '../services/leaderboard.ts';
import { listTournaments } from '../services/tournaments.ts';
import { Link, navigate } from '../router.tsx';
import { db } from '../services/supabase.ts';
import type { LiveMatch } from '../types/models.ts';

async function loadLive(): Promise<LiveMatch[]> {
  if (!backendConfigured) return demoLiveMatches();
  const rows = await db.select<any>('match_view', { filter: { status: 'eq.active' }, order: 'created_at.desc', limit: 4 });
  return rows.map((r: any) => ({ id: r.id, white: r.white_name, black: r.black_name ?? '—', whiteRating: r.white_rating, blackRating: r.black_rating ?? 0, moves: r.move_count ?? 0 }));
}

export function Home() {
  const { t, num, relative, dateTime } = useI18n();
  const { me, rank, mode, matches, signedIn, local } = useAuth();

  const top = useAsync(() => fetchLeaderboard({ scope: 'all', search: '', page: 0, pageSize: 5 }, { me, friendIds: [] }), [mode, me?.rating]);
  const online = useAsync(() => onlineCount(), [mode]);
  const active = useAsync(() => recentlyActive(5), [mode]);
  const live = useAsync(loadLive, [mode]);
  const tours = useAsync(() => listTournaments(local?.tournaments ?? [], me?.id ?? null), [mode, me?.id]);

  const greeting = signedIn && me ? t('home.greeting', { name: me.username }) : t('home.greetingGuest');
  const upcoming = (tours.data ?? []).filter((x) => x.status === 'upcoming').slice(0, 3);
  const modes = [
    { to: '/play?mode=quick&go=1', icon: LuSwords, key: 'mode.quick', desc: 'mode.quickDesc', accent: true },
    { to: '/play?mode=friends', icon: LuUsers, key: 'mode.friends', desc: 'mode.friendsDesc' },
    { to: '/play?mode=bot', icon: LuBot, key: 'mode.bot', desc: 'mode.botDesc' },
    { to: '/play?mode=practice', icon: LuGraduationCap, key: 'mode.practice', desc: 'mode.practiceDesc' },
  ] as const;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{greeting}</p>
          <h1>{t('hero.title')}</h1>
          <p className="lead">{t('hero.sub')}</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/play?mode=quick&go=1')}>
              <LuSwords /> {t('hero.playNow')}
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => navigate('/play?mode=friends')}>
              <LuUsers /> {t('mode.friends')}
            </button>
          </div>
          {signedIn && me ? (
            <div className="hero-stats">
              <div>
                <span className="hero-stat-v">{num(me.rating)}</span>
                <span className="hero-stat-l">{t('common.rating')}</span>
              </div>
              <div>
                <span className="hero-stat-v">{(rank ?? top.data?.me?.rank) ? `#${num((rank ?? top.data?.me?.rank)!)}` : '—'}</span>
                <span className="hero-stat-l">{t('common.rank')}</span>
              </div>
              <div>
                <span className="hero-stat-v">{winRate(me.wins, me.losses, me.draws)}%</span>
                <span className="hero-stat-l">{t('common.winRate')}</span>
              </div>
              {mode === 'demo' && <span className="badge badge-demo">{t('demo.localRating')}</span>}
            </div>
          ) : (
            <p className="muted small">{t('hero.guestHint')}</p>
          )}
        </div>
        <HeroBoard />
      </section>

      <DemoNotice text={t('demo.homeNotice')} />

      <section aria-label={t('home.modes')}>
        <div className="mode-grid">
          {modes.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.to} to={m.to} className={`mode-card ${'accent' in m ? 'mode-card-accent' : ''}`}>
                <span className="mode-icon">
                  <Icon />
                </span>
                <span className="mode-title">{t(m.key)}</span>
                <span className="mode-desc">{t(m.desc)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-top">
          <SectionHead title={t('home.topPlayers')} action={<SeeAll to="/leaderboard" label={t('common.seeAll')} />} />
          {top.loading ? (
            <Spinner />
          ) : top.error ? (
            <ErrorState onRetry={top.reload} />
          ) : (
            <ol className="rows">
              {top.data!.rows.map((p) => (
                <li key={p.id}>
                  <Link to={`/profile/${p.id}`} className="row">
                    <span className={`rank-chip ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}>{p.rank}</span>
                    <Avatar name={p.username} seed={p.avatar} size={34} online={isOnline(p)} />
                    <span className="row-main">
                      <span className="row-title">
                        {p.username}
                        <LevelBadge rating={p.rating} label={(n) => t('level.short', { n })} />
                      </span>
                      <span className="row-sub">
                        {num(p.wins)} {t('common.winsShort')} · {winRate(p.wins, p.losses, p.draws)}%
                      </span>
                    </span>
                    <span className="row-end">
                      <strong>{num(p.rating)}</strong>
                      <Delta value={p.lastDelta} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {top.data?.source === 'demo' && <p className="muted small foot">{t('demo.sampleData')}</p>}
        </section>

        <section className="card" aria-labelledby="h-live">
          <SectionHead
            title={t('home.liveMatches')}
            action={
              <span className="online-now" title={t('home.onlineNow')}>
                <span className="dot dot-on" /> {online.data !== null ? num(online.data) : '…'} {t('home.onlineNow').toLowerCase()}
              </span>
            }
          />
          {live.loading ? (
            <Spinner />
          ) : live.error ? (
            <ErrorState onRetry={live.reload} />
          ) : (live.data ?? []).length === 0 ? (
            <EmptyState title={t('home.noLive')} />
          ) : (
            <ul className="rows">
              {live.data!.map((m) => (
                <li key={m.id} className="row row-static">
                  <LuRadio className="live-icon" />
                  <span className="row-main">
                    <span className="row-title">
                      {m.white} <span className="muted">vs</span> {m.black}
                    </span>
                    <span className="row-sub">
                      {num(m.whiteRating)} · {num(m.blackRating)} · {t('home.movesN', { n: m.moves })}
                    </span>
                  </span>
                  {m.demo && <span className="badge badge-demo">{t('demo.badge')}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid-3">
        <section className="card">
          <SectionHead title={t('home.upcoming')} action={<SeeAll to="/leaderboard?tab=tournaments" label={t('common.seeAll')} />} />
          {tours.loading ? (
            <Spinner />
          ) : tours.error ? (
            <ErrorState onRetry={tours.reload} />
          ) : upcoming.length === 0 ? (
            <EmptyState title={t('tour.emptyUpcoming')} />
          ) : (
            <ul className="rows">
              {upcoming.map((x) => (
                <li key={x.id}>
                  <Link to="/leaderboard?tab=tournaments" className="row">
                    <span className="row-main">
                      <span className="row-title">{x.name}</span>
                      <span className="row-sub">{dateTime(x.startsAt)}</span>
                    </span>
                    <span className="badge badge-free">{t('common.free')}</span>
                    {x.demo && <span className="badge badge-demo">{t('demo.badge')}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <SectionHead title={t('home.recentGames')} />
          {matches.length === 0 ? (
            <EmptyState title={t('home.noGames')} hint={t('home.noGamesHint')} />
          ) : (
            <ul className="rows">
              {matches.slice(0, 5).map((m) => (
                <li key={m.id} className="row row-static">
                  <span className={`result-chip result-${m.result}`}>{t(`result.${m.result}` as 'result.win')}</span>
                  <span className="row-main">
                    <span className="row-title">{m.opponent}</span>
                    <span className="row-sub">{relative(m.ts)}</span>
                  </span>
                  {m.rated ? <Delta value={m.delta} /> : <span className="badge">{t('common.unrated')}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <SectionHead title={t('home.recentlyActive')} />
          {active.loading ? (
            <Spinner />
          ) : active.error ? (
            <ErrorState onRetry={active.reload} />
          ) : (
            <ul className="rows">
              {active.data!.map((p) => (
                <li key={p.id}>
                  <Link to={`/profile/${p.id}`} className="row">
                    <Avatar name={p.username} seed={p.avatar} size={34} online={isOnline(p)} />
                    <span className="row-main">
                      <span className="row-title">{p.username}</span>
                      <span className="row-sub">{isOnline(p) ? t('common.online') : relative(p.lastSeen)}</span>
                    </span>
                    <strong>{num(p.rating)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {mode === 'demo' && <p className="muted small foot">{t('demo.sampleData')}</p>}
        </section>
      </div>
    </div>
  );
}
