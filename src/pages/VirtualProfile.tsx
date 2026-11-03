import { LuBot, LuSwords } from 'react-icons/lu';
import { AiBadge } from '../components/AiBadge.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { Stat, winRate } from '../components/ui.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { virtualProfile } from '../services/online.ts';

/** Public card of a virtual (AI) opponent: clearly marked as AI, with its own rating and record. */
export function VirtualProfile() {
  const { t, num, dateTime } = useI18n();
  const { segments } = useRoute();
  const id = segments[1] ?? '';
  const p = useAsync(() => virtualProfile(id), [id]);
  if (p.loading && !p.data) return <div className="page"><Spinner /></div>;
  if (p.error) return <div className="page"><ErrorState onRetry={p.reload} /></div>;
  const v = p.data;
  if (!v) return <div className="page"><EmptyState title={t('profile.notFound')} /></div>;
  const games = v.wins + v.losses + v.draws;
  return (
    <div className="page page-narrow">
      <section className="card profile-head vp-head">
        <div className="profile-avatar">
          <Avatar name={v.nickname} seed={v.avatar} size={96} />
        </div>
        <div className="profile-id">
          <h1 className="h1">
            {v.nickname} <AiBadge />
          </h1>
          <div className="chips">
            <span className="chip">
              <LuBot /> {t('virtual.chip')}
            </span>
            <span className="chip">{t(`virtual.level.${v.level}` as TKey)}</span>
            <span className="chip">{t(`virtual.style.${v.style}` as TKey)}</span>
          </div>
          <p className="muted small">{t('virtual.about')}</p>
        </div>
        <div className="profile-rating">
          <div className="pr-block">
            <span className="pr-value">{num(v.rating)}</span>
            <span className="pr-label">{t('common.rating')}</span>
          </div>
        </div>
      </section>
      <section className="stats-grid" aria-label={t('profile.stats')}>
        <Stat label={t('common.games')} value={num(games)} />
        <Stat label={t('common.wins')} value={num(v.wins)} tone="win" />
        <Stat label={t('common.losses')} value={num(v.losses)} tone="loss" />
        <Stat label={t('common.draws')} value={num(v.draws)} />
        <Stat label={t('common.winRate')} value={`${winRate(v.wins, v.losses, v.draws)}%`} tone="gold" />
      </section>
      <h2 className="h2">{t('virtual.recent')}</h2>
      {v.recent.length === 0 ? (
        <p className="muted">{t('virtual.noGames')}</p>
      ) : (
        <ul className="admin-list">
          {v.recent.map((g) => (
            <li key={g.id}>
              <Link to={`/watch?m=${g.id}`} className="admin-row">
                <span className={`res-dot ${g.result === 'draw' ? 'res-draw' : g.result === 'black' ? 'res-win' : 'res-loss'}`} aria-hidden="true" />
                <span className="admin-row-main">
                  <strong>{g.opponent}</strong>
                  <span className="muted small">
                    {t(g.result === 'draw' ? 'result.drawn' : g.result === 'black' ? 'result.victory' : 'result.defeat')}
                    {g.time_control ? ` · ${t('tc.minutes', { n: g.time_control / 60 })}` : ''} · {dateTime(Date.parse(g.ended_at))}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link to="/play?mode=quick" className="btn btn-primary">
          <LuSwords /> {t('mode.quick')}
        </Link>
      </p>
    </div>
  );
}
