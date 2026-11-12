import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCalendarClock, LuCrown, LuInfo, LuSwords, LuTrophy, LuUsers } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { dailyOverview, type DailyOverview } from '../services/daily.ts';
import { appActive, tg } from '../services/telegram.ts';
import { splitDuration } from '../services/weekly.ts';
import { useAuthDialog } from './AuthDialog.tsx';
import { Avatar, LevelBadge } from './Avatar.tsx';
import { ErrorState, Spinner } from './States.tsx';

const POLL_MS = 15_000;

/** Daily rating: no joining, points = rating won today (Tashkent), top 10 + my place, prize for #1, yesterday's winner. */
export function DailyRating() {
  const { t, lang } = useI18n();
  const { me, signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const [ov, setOv] = useState<DailyOverview | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const skew = useRef(0); // server clock − local clock
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const t0 = Date.now();
      const o = await dailyOverview();
      const t1 = Date.now();
      const server = Date.parse(o.server_now);
      if (Number.isFinite(server)) skew.current = server - (t0 + t1) / 2;
      setOv(o);
      setError(false);
      setUpdatedAt(Date.now());
    } catch {
      setError(true);
    } finally {
      loading.current = false;
    }
  }, []);

  // live: poll while the app is open, re-read at once when it comes back to the foreground
  useEffect(() => {
    void load();
    const id = setInterval(() => appActive() && void load(), POLL_MS);
    const onWake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => appActive() && setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const endsAt = ov ? Date.parse(ov.ends_at) - skew.current : 0;
  const left = ov ? endsAt - now : 0;
  // midnight passed → read the new day (and yesterday's winner)
  const rolled = useRef<string | null>(null);
  useEffect(() => {
    if (ov && left <= 0 && rolled.current !== ov.day) {
      rolled.current = ov.day;
      setTimeout(() => void load(), 1500);
    }
  }, [left, ov, load]);

  if (error && !ov) return <ErrorState onRetry={load} />;
  if (!ov) return <Spinner />;

  const parts = splitDuration(left);
  const my = ov.me;
  const myInTop = !!my?.rank && ov.top.some((r) => r.user_id === me?.id);
  const y = ov.yesterday;

  return (
    <section className="wk dr" aria-labelledby="dr-title">
      {/* ---------------- hero ---------------- */}
      <div className="wk-hero dr-hero">
        <div className="wk-hero-top">
          <span className="wk-live" role="status">
            <span className="wk-dot" aria-hidden="true" /> {t('weekly.live')}
          </span>
          <span className="wk-season">{shortDay(ov.day, lang)}</span>
        </div>
        <div className="wk-title-row">
          <span className="wk-trophy" aria-hidden="true">
            <LuTrophy />
          </span>
          <div>
            <h2 id="dr-title" className="wk-title">
              DAMEO <span>DAILY</span>
            </h2>
            <p className="wk-sub">
              {t('daily.title')} · {t('daily.tz')}
            </p>
          </div>
        </div>

        <div className="wk-countdown" role="timer" aria-label={t('daily.resetsIn')}>
          <span className="wk-cd-label">{t('daily.resetsIn')}</span>
          <div className="wk-cd-tiles dr-cd-tiles">
            {(
              [
                [parts.d * 24 + parts.h, 'weekly.hours'],
                [parts.m, 'weekly.minutes'],
                [parts.s, 'weekly.seconds'],
              ] as Array<[number, TKey]>
            ).map(([v, k]) => (
              <div className="wk-cd-tile" key={k}>
                <strong>{String(v).padStart(2, '0')}</strong>
                <span>{t(k)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* prize */}
        <div className="dr-prize">
          <span className="dr-prize-icon" aria-hidden="true">
            🧸
          </span>
          <span className="dr-prize-text">
            <span className="dr-prize-label">{t('daily.prizeLabel')}</span>
            <strong>{t('daily.prize')}</strong>
            <span className="dr-prize-hint">{t('daily.prizeHint')}</span>
          </span>
        </div>

        <ul className="wk-meta">
          <li>
            <LuUsers /> {t('daily.players', { n: ov.players })}
          </li>
          <li>
            <LuCalendarClock /> {t('daily.resetAt')}
          </li>
        </ul>
        <p className="dr-nojoin">{t('daily.noJoin')}</p>

        {/* my place */}
        {signedIn && my ? (
          <div className="wk-me dr-me">
            <span className={`wk-rank-badge dr-me-rank ${my.rank && my.rank <= 3 ? `wk-rank-${my.rank}` : ''}`}>{my.rank ?? '—'}</span>
            <div>
              <span className="dr-me-label">{t('daily.myPlace')}</span>
              <strong>{my.rank ? t('daily.myRank', { n: my.rank }) : '—'}</strong>
              <span className="muted small">
                {my.points > 0 ? `+${my.points} ${t('daily.col.points').toLowerCase()}` : t('daily.noPoints')} · {my.wins}-{my.losses}-{my.draws}
              </span>
            </div>
            <Link to="/play?mode=quick" className="btn btn-primary btn-sm">
              <LuSwords /> {t('daily.playNow')}
            </Link>
          </div>
        ) : (
          <button className="btn wk-join btn-lg btn-block" onClick={() => openAuth()}>
            <LuTrophy /> {t('daily.signIn')}
          </button>
        )}
      </div>

      {/* ---------------- top 10 ---------------- */}
      <div className="card wk-table-card">
        <div className="wk-table-head">
          <h3>{t('daily.top')}</h3>
          <span className="wk-updated muted small">
            <span className="wk-dot" aria-hidden="true" />{' '}
            {updatedAt ? t('daily.updated', { at: new Date(updatedAt).toLocaleTimeString(lang === 'uz' ? 'uz-UZ' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : ''}
          </span>
        </div>
        {ov.top.length === 0 ? (
          <p className="muted wk-empty">{t('daily.empty')}</p>
        ) : (
          <table className="wk-table dr-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('daily.col.player')}</th>
                <th scope="col" className="num">{t('daily.col.points')}</th>
                <th scope="col" className="num">{t('daily.col.wld')}</th>
              </tr>
            </thead>
            <tbody>
              {ov.top.map((r) => (
                <Row key={r.user_id} r={r} mine={me?.id === r.user_id} />
              ))}
              {signedIn && my?.rank && !myInTop && (
                <>
                  <tr className="dr-gap" aria-hidden="true">
                    <td colSpan={4}>
                      <span>• • •</span>
                    </td>
                  </tr>
                  <Row r={{ ...my, rank: my.rank, user_id: me?.id ?? '' }} mine />
                </>
              )}
            </tbody>
          </table>
        )}
        <p className="muted small wk-foot">{t('daily.note')}</p>
      </div>

      {/* ---------------- yesterday ---------------- */}
      {y && (
        <div className="card dr-yesterday">
          <span className="dr-y-crown" aria-hidden="true">
            <LuCrown />
          </span>
          <Link to={`/profile/${y.user_id}`} className="dr-y-main">
            <Avatar name={y.username} seed={y.avatar} size={46} userId={y.user_id} ring="gold" />
            <span className="dr-y-text">
              <span className="dr-y-label">
                {t('daily.yesterday')} · {shortDay(y.day, lang)}
              </span>
              <strong>{y.username}</strong>
              <span className="muted small">{t('daily.yesterdayStats', { p: y.points, g: y.games, w: y.wins })}</span>
            </span>
          </Link>
          <span className="dr-y-prize" title={t('daily.prize')}>
            🧸
          </span>
        </div>
      )}

      {/* ---------------- rules ---------------- */}
      <details className="card wk-rules">
        <summary>
          <LuInfo /> {t('daily.rulesTitle')}
        </summary>
        <ul>
          <li>{t('daily.rule1')}</li>
          <li>{t('daily.rule2')}</li>
          <li>{t('daily.rule3')}</li>
          <li>{t('daily.rule4')}</li>
          <li>{t('daily.rule5')}</li>
        </ul>
      </details>
    </section>
  );
}

const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "11-noyabr" / "11 Nov" from "2026-11-11". */
function shortDay(day: string, lang: string) {
  const [, m, d] = day.split('-').map(Number);
  return lang === 'uz' ? `${d}-${UZ_MONTHS[m - 1]}` : `${d} ${EN_MONTHS[m - 1]}`;
}

function Row({ r, mine }: { r: { rank: number; user_id: string; username: string; avatar: string; rating: number; points: number; wins: number; losses: number; draws: number }; mine: boolean }) {
  const { t } = useI18n();
  return (
    <tr className={`${r.rank === 1 ? 'wk-row-prize wk-row-1' : r.rank <= 3 ? 'dr-row-podium' : ''} ${mine ? 'wk-row-me' : ''}`}>
      <td className="wk-rank">
        <span className={`wk-rank-badge ${r.rank <= 3 ? `wk-rank-${r.rank}` : ''}`}>{r.rank}</span>
      </td>
      <td>
        <Link to={`/profile/${r.user_id}`} className="wk-player">
          <Avatar name={r.username} seed={r.avatar} size={32} userId={r.user_id} />
          <span className="wk-player-name">
            <span>
              {r.username} {mine && <span className="badge">{t('daily.you')}</span>}
            </span>
            <span className="wk-player-sub">
              <LevelBadge rating={r.rating} label={(n) => t('level.short', { n })} /> {r.rank === 1 && <span aria-label={t('daily.prize')}>🧸</span>}
            </span>
          </span>
        </Link>
      </td>
      <td className="num wk-points delta-up">+{r.points}</td>
      <td className="num wk-wld">
        {r.wins}-{r.losses}-{r.draws}
      </td>
    </tr>
  );
}
