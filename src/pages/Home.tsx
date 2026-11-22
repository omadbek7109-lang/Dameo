import { LuArrowRight, LuBot, LuChartColumn, LuFlame, LuGift, LuGraduationCap, LuStar, LuTrophy, LuUsers, LuZap } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { levelOf } from '../services/levels.ts';
import { PromoCarousel } from '../components/PromoCarousel.tsx';
import { Spinner } from '../components/States.tsx';
import { Delta, winRate } from '../components/ui.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useI18n } from '../i18n/index.tsx';
import { backendConfigured } from '../services/config.ts';
import { demoLiveMatches } from '../services/demoData.ts';
import { fetchLeaderboard } from '../services/leaderboard.ts';
import { Link } from '../router.tsx';
import { MissionsHomeCard } from './Missions.tsx';
import { PassHomeCard } from './Pass.tsx';
import { db } from '../services/supabase.ts';
import type { LiveMatch } from '../types/models.ts';

async function loadLive(): Promise<LiveMatch[]> {
  if (!backendConfigured) return demoLiveMatches();
  const rows = await db.select<any>('match_view', { filter: { status: 'eq.active' }, order: 'created_at.desc', limit: 2 });
  return rows.map((r: any) => ({ id: r.id, white: r.white_name, black: r.black_name ?? '—', whiteRating: r.white_rating, blackRating: r.black_rating ?? 0, moves: r.move_count ?? 0 }));
}

/** Arena: the home screen. One glance — who you are, one big button to play, today's goals, live games. */
export function Home() {
  const { t, num } = useI18n();
  const { me, rank, mode, matches, signedIn } = useAuth();

  // rank only when the auth context has none yet (one small query, not the whole leaderboard UI)
  const top = useAsync(() => (rank ? Promise.resolve(null) : fetchLeaderboard({ scope: 'all', search: '', page: 0, pageSize: 1 }, { me, friendIds: [] })), [mode, me?.rating, rank]);
  const live = useAsync(loadLive, [mode]);

  const wr = me ? winRate(me.wins, me.losses, me.draws) : 0;
  const lastDelta = matches.find((m) => m.rated)?.delta ?? null;
  const myRank = rank ?? top.data?.me?.rank ?? null;
  const lv = levelOf(me?.rating ?? 1200);
  const firstLive = (live.data ?? [])[0];

  return (
    <div className="page page-home">
      <PromoCarousel />

      <Link to="/play?mode=quick&go=1" className="arena-find">
        <LuZap className="arena-find-ico" aria-hidden="true" />
        <span className="arena-find-text">
          <span className="arena-find-title">{t('mode.quick')}</span>
          <span className="arena-find-sub">{t('home.findSub')}</span>
        </span>
        <span className="arena-round-go" aria-hidden="true">
          <LuArrowRight />
        </span>
      </Link>

      {signedIn && me && (
        <section className="arena-stats" aria-label={t('common.rating')}>
          <Link to="/leaderboard" className="arena-stat">
            <LuTrophy className="arena-stat-ico ico-gold" aria-hidden="true" />
            <span className="arena-stat-v">{num(me.rating)}</span>
            <span className="arena-stat-l">
              {t('common.rating')} {lastDelta !== null && lastDelta !== 0 && <Delta value={lastDelta} />}
            </span>
          </Link>
          <Link to="/leaderboard" className="arena-stat">
            <LuChartColumn className="arena-stat-ico ico-indigo" aria-hidden="true" />
            <span className="arena-stat-v">{myRank ? `#${num(myRank)}` : '—'}</span>
            <span className="arena-stat-l">{t('common.rank')}</span>
          </Link>
          <Link to="/profile" className="arena-stat arena-stat-ring">
            <span className="arena-ring" aria-hidden="true">
              <svg viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="27" className="arena-ring-bg" />
                <circle cx="32" cy="32" r="27" className="arena-ring-fg" pathLength={100} strokeDasharray={`${wr} 100`} />
              </svg>
              <span className="arena-ring-v">{wr}%</span>
            </span>
            <span className="arena-stat-l">{t('common.winRate')}</span>
          </Link>
          {mode === 'demo' && <span className="badge badge-demo arena-stats-badge">{t('demo.badge')}</span>}
        </section>
      )}

      {me && (
        <Link to="/profile" className="arena-level">
          <span className="arena-level-badge">
            <LuStar aria-hidden="true" /> {t('level.name', { n: lv.level })}
          </span>
          <span className="arena-level-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(lv.progress * 100)}%` }} />
          </span>
          <span className="arena-level-next">{lv.next === null ? t('level.max') : t('level.toNext', { next: lv.level + 1, n: lv.next - me.rating })}</span>
        </Link>
      )}

      <nav className="arena-quick" aria-label={t('home.modes')}>
        <Link to="/play?mode=bot" className="arena-q">
          <span className="arena-q-ico q-blue"><LuBot /></span>
          <span>{t('home.qBot')}</span>
        </Link>
        <Link to="/play?mode=friends" className="arena-q">
          <span className="arena-q-ico q-violet"><LuUsers /></span>
          <span>{t('home.qFriend')}</span>
        </Link>
        <Link to="/referral" className="arena-q">
          <span className="arena-q-ico q-gold"><LuGift /></span>
          <span>{t('home.qInvite')}</span>
        </Link>
        <Link to="/play?mode=practice" className="arena-q">
          <span className="arena-q-ico q-green"><LuGraduationCap /></span>
          <span>{t('home.qPractice')}</span>
        </Link>
      </nav>

      <PassHomeCard />
      <MissionsHomeCard />

      <section className="arena-live" aria-labelledby="h-live">
        <div className="arena-sec-head">
          <h2 id="h-live">
            <LuFlame className="arena-flame" aria-hidden="true" /> {t('home.liveMatches')}
          </h2>
          <Link to="/live" className="arena-see-all">
            {t('common.seeAll')} <LuArrowRight aria-hidden="true" />
          </Link>
        </div>
        {live.loading ? (
          <Spinner />
        ) : !firstLive ? (
          <div className="arena-live-row arena-live-empty">
            <span className="muted">{t('home.noLive')}</span>
          </div>
        ) : (
          <div className="arena-live-row">
            <Avatar name={firstLive.white} size={56} />
            <span className="arena-live-main">
              <span className="arena-live-on">
                <span className="dot dot-on" /> {t('common.online')}
                {firstLive.demo && <span className="badge badge-demo">{t('demo.badge')}</span>}
              </span>
              <span className="arena-live-title">
                {firstLive.white} vs {firstLive.black}
              </span>
              <span className="arena-live-sub">
                {num(firstLive.whiteRating)} · {num(firstLive.blackRating)} · {t('home.movesN', { n: firstLive.moves })}
              </span>
            </span>
            <Link to={firstLive.demo ? '/live' : `/watch?m=${firstLive.id}`} className="arena-watch">
              {t('home.watch')} <LuArrowRight aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>

    </div>
  );
}
