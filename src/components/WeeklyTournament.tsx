import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCalendarClock, LuCheck, LuCrown, LuInfo, LuLoader, LuSwords, LuTrophy, LuUsers } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { SbError } from '../services/supabase.ts';
import { haptic, tg } from '../services/telegram.ts';
import {
  formatTashkent,
  formatWeekRange,
  PRIZE_PLACES,
  splitDuration,
  WEEKLY_PRIZES,
  weeklyJoin,
  weeklyOverview,
  weeklyStandings,
  type WeeklyOverview,
  type WeeklyRow,
  type WeeklyWinner,
} from '../services/weekly.ts';
import { useAuthDialog } from './AuthDialog.tsx';
import { Avatar, LevelBadge } from './Avatar.tsx';
import { Confetti } from './Confetti.tsx';
import { Modal } from './Modal.tsx';
import { ErrorState, Spinner } from './States.tsx';
import { useToast } from './Toast.tsx';

const POLL_MS = 15_000;
const SEEN_KEY = 'dameo.weekly.resultsSeen';
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (id: string) => {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* private mode */
  }
};

const prizeFor = (rank: number | null | undefined) => (rank && rank <= PRIZE_PLACES ? WEEKLY_PRIZES[rank - 1] : null);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** DAMEO Weekly Tournament: live standings from the global rating, countdown, prizes and last week's winners. */
export function WeeklyTournament() {
  const { t, num, lang } = useI18n();
  const { me, signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const [ov, setOv] = useState<WeeklyOverview | null>(null);
  const [rows, setRows] = useState<WeeklyRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [results, setResults] = useState(false);
  /** server clock − local clock */
  const skew = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const t0 = Date.now();
      const o = await weeklyOverview();
      const t1 = Date.now();
      const server = Date.parse(o.server_now);
      if (Number.isFinite(server)) skew.current = server - (t0 + t1) / 2;
      const r = await weeklyStandings(o.current.id);
      setOv(o);
      setRows(r);
      setError(false);
      setUpdatedAt(Date.now());
    } catch {
      setError(true);
    } finally {
      loading.current = false;
    }
  }, []);

  // live: poll, and re-read at once when the app comes back to the foreground
  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    const onWake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onWake);
    tg?.onEvent?.('activated', onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      tg?.offEvent?.('activated', onWake);
    };
  }, [load]);

  // 1 s countdown (server-anchored)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const endsAt = ov ? Date.parse(ov.current.ends_at) - skew.current : 0;
  const left = ov ? endsAt - now : 0;
  // the week just ended → fetch the frozen results and the new week
  const rolled = useRef<string | null>(null);
  useEffect(() => {
    if (ov && left <= 0 && rolled.current !== ov.current.id) {
      rolled.current = ov.current.id;
      setTimeout(() => void load(), 1500);
    }
  }, [left, ov, load]);

  // winners screen: shown once per finished tournament
  const prev = ov?.previous;
  const winners = prev?.winners ?? [];
  useEffect(() => {
    if (prev && winners.length > 0 && readSeen() !== prev.id) setResults(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev?.id]);
  const closeResults = () => {
    if (prev) writeSeen(prev.id);
    setResults(false);
  };

  const join = async () => {
    if (!signedIn) return openAuth();
    setBusy(true);
    try {
      await weeklyJoin();
      haptic('win');
      toast('success', t('weekly.joined'));
      await load();
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', t(/finished/.test(msg) ? 'weekly.err.finished' : 'weekly.err.join'));
    } finally {
      setBusy(false);
    }
  };

  if (error && !ov) return <ErrorState onRetry={load} />;
  if (!ov) return <Spinner />;

  const cur = ov.current;
  const startTs = Date.parse(cur.starts_at);
  const nextTs = Date.parse(ov.next_starts_at);
  const parts = splitDuration(left);
  const joined = ov.me.joined;
  const myRank = ov.me.rank ?? null;
  const ranked = (rows ?? []).filter((r) => r.rank !== null);
  const unranked = (rows ?? []).filter((r) => r.rank === null);

  return (
    <section className="wk" aria-labelledby="wk-title">
      {/* ---------------- hero ---------------- */}
      <div className="wk-hero">
        <div className="wk-hero-top">
          <span className="wk-live" role="status">
            <span className="wk-dot" aria-hidden="true" /> {t('weekly.live')}
          </span>
          <span className="wk-season">{cur.name}</span>
        </div>
        <div className="wk-title-row">
          <span className="wk-trophy" aria-hidden="true">
            <LuTrophy />
          </span>
          <div>
            <h2 id="wk-title" className="wk-title">
              DAMEO <span>WEEKLY</span>
            </h2>
            <p className="wk-sub">
              {formatWeekRange(startTs, Date.parse(cur.ends_at), lang)} · {t('weekly.tz')}
            </p>
          </div>
        </div>

        <div className="wk-countdown" role="timer" aria-label={t('weekly.endsIn')}>
          <span className="wk-cd-label">{t('weekly.endsIn')}</span>
          <div className="wk-cd-tiles">
            {(
              [
                [parts.d, 'weekly.days'],
                [parts.h, 'weekly.hours'],
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

        <ul className="wk-meta">
          <li>
            <LuUsers /> {t('weekly.participants', { n: num(cur.participants) })}
          </li>
          <li>
            <LuCalendarClock /> {t('weekly.endsAt', { at: formatTashkent(Date.parse(cur.ends_at) - 60_000, lang) })}
          </li>
          <li>
            <LuSwords /> {t('weekly.nextAt', { at: formatTashkent(nextTs, lang) })}
          </li>
        </ul>

        {joined ? (
          <div className="wk-me">
            <span className="wk-me-check">
              <LuCheck />
            </span>
            <div>
              <strong>{t('weekly.youAreIn')}</strong>
              <span className="muted small">
                {myRank ? t('weekly.myRank', { n: myRank }) : t('weekly.playToRank')} · {t('weekly.points', { n: signed(ov.me.delta ?? 0) })}
              </span>
            </div>
            <Link to="/play?mode=quick" className="btn btn-primary btn-sm">
              <LuSwords /> {t('weekly.play')}
            </Link>
          </div>
        ) : (
          <button className="btn wk-join btn-lg btn-block" onClick={join} disabled={busy}>
            {busy ? <LuLoader className="spin" /> : <LuTrophy />} {signedIn ? t('weekly.join') : t('weekly.signInToJoin')}
          </button>
        )}
      </div>

      {/* ---------------- prizes ---------------- */}
      <div className="wk-prizes" aria-label={t('weekly.prizes')}>
        {WEEKLY_PRIZES.map((p) => (
          <div key={p.place} className={`wk-prize wk-prize-${p.place}`}>
            <span className="wk-prize-place">{p.place}</span>
            <span className="wk-prize-icon" aria-hidden="true">
              {p.icon}
            </span>
            <span className="wk-prize-name">{t(p.key as TKey)}</span>
          </div>
        ))}
      </div>

      {/* ---------------- rules ---------------- */}
      <details className="card wk-rules">
        <summary>
          <LuInfo /> {t('weekly.rulesTitle')}
        </summary>
        <ul>
          <li>{t('weekly.rule1')}</li>
          <li>{t('weekly.rule2')}</li>
          <li>{t('weekly.rule3')}</li>
          <li>{t('weekly.rule4')}</li>
          <li>{t('weekly.rule5')}</li>
        </ul>
      </details>

      {/* ---------------- live table ---------------- */}
      <div className="card wk-table-card">
        <div className="wk-table-head">
          <h3>{t('weekly.standings')}</h3>
          <span className="wk-updated muted small">
            <span className="wk-dot" aria-hidden="true" /> {updatedAt ? t('weekly.updated', { at: new Date(updatedAt).toLocaleTimeString(lang === 'uz' ? 'uz-UZ' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : ''}
          </span>
        </div>
        {(rows ?? []).length === 0 ? (
          <p className="muted wk-empty">{t('weekly.empty')}</p>
        ) : (
          <table className="wk-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('weekly.col.player')}</th>
                <th scope="col" className="num">{t('weekly.col.points')}</th>
                <th scope="col" className="num">{t('weekly.col.wld')}</th>
                <th scope="col" className="num wk-hide-sm">{t('weekly.col.rating')}</th>
              </tr>
            </thead>
            <tbody>
              {[...ranked, ...unranked].map((r) => {
                const prize = prizeFor(r.rank);
                const mine = me?.id === r.user_id;
                return (
                  <tr key={r.user_id} className={`${prize ? `wk-row-prize wk-row-${r.rank}` : ''} ${mine ? 'wk-row-me' : ''}`}>
                    <td className="wk-rank">{r.rank ? <span className={`wk-rank-badge ${r.rank <= 3 ? `wk-rank-${r.rank}` : ''}`}>{r.rank}</span> : <span className="muted">—</span>}</td>
                    <td>
                      <Link to={`/profile/${r.user_id}`} className="wk-player">
                        <Avatar name={r.username} seed={r.avatar} size={32} />
                        <span className="wk-player-name">
                          <span>
                            {r.username} {mine && <span className="badge">{t('common.you')}</span>}
                          </span>
                          <span className="wk-player-sub">
                            <LevelBadge rating={r.rating} label={(n) => t('level.short', { n })} /> {prize && <span aria-label={t(prize.key as TKey)}>{prize.icon}</span>}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className={`num wk-points ${r.delta > 0 ? 'delta-up' : r.delta < 0 ? 'delta-down' : ''}`}>{r.games > 0 ? signed(r.delta) : '—'}</td>
                    <td className="num wk-wld">
                      {r.wins}-{r.losses}-{r.draws}
                    </td>
                    <td className="num wk-hide-sm">{num(r.rating)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small wk-foot">{t('weekly.tableNote')}</p>
      </div>

      {/* ---------------- last week ---------------- */}
      {prev && winners.length > 0 && (
        <div className="card wk-prev">
          <div className="wk-table-head">
            <h3>
              <LuCrown /> {t('weekly.lastWinners')}
            </h3>
            <span className="muted small">{formatWeekRange(Date.parse(prev.starts_at), Date.parse(prev.ends_at), lang)}</span>
          </div>
          <WinnersList winners={winners} />
          <button className="btn btn-secondary btn-block" onClick={() => setResults(true)}>
            <LuTrophy /> {t('weekly.viewResults')}
          </button>
        </div>
      )}

      {prev && winners.length > 0 && <ResultsModal open={results} onClose={closeResults} name={prev.name} range={formatWeekRange(Date.parse(prev.starts_at), Date.parse(prev.ends_at), lang)} winners={winners} myId={me?.id} />}
    </section>
  );
}

function WinnersList({ winners }: { winners: WeeklyWinner[] }) {
  const { t } = useI18n();
  return (
    <ol className="wk-winners">
      {winners.map((w) => {
        const prize = prizeFor(w.rank);
        return (
          <li key={w.user_id} className={`wk-winner wk-winner-${w.rank}`}>
            <span className={`wk-rank-badge ${w.rank <= 3 ? `wk-rank-${w.rank}` : ''}`}>{w.rank}</span>
            <Avatar name={w.username} seed={w.avatar} size={30} />
            <span className="wk-winner-name">{w.username}</span>
            <span className="wk-points delta-up">{signed(w.delta)}</span>
            {prize && (
              <span className="wk-winner-prize" title={t(prize.key as TKey)}>
                {prize.icon}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Winners ceremony: podium rises, confetti, the full top-5 with prizes. */
function ResultsModal({ open, onClose, name, range, winners, myId }: { open: boolean; onClose: () => void; name: string; range: string; winners: WeeklyWinner[]; myId?: string }) {
  const { t } = useI18n();
  const top3 = [winners[1], winners[0], winners[2]].filter(Boolean) as WeeklyWinner[];
  const mine = winners.find((w) => w.user_id === myId);
  useEffect(() => {
    if (open) haptic(mine ? 'win' : 'move');
  }, [open, mine]);
  return (
    <Modal open={open} onClose={onClose} title={t('weekly.resultsTitle')}>
      <div className="wk-results">
        <Confetti count={48} />
        <p className="wk-results-name">
          {name} · {range}
        </p>
        {mine && <p className="wk-congrats">{t('weekly.congrats', { n: mine.rank, prize: t(prizeFor(mine.rank)!.key as TKey) })}</p>}
        <div className="wk-podium">
          {top3.map((w) => (
            <div key={w.user_id} className={`wk-pod wk-pod-${w.rank}`} style={{ animationDelay: `${w.rank === 1 ? 0.5 : w.rank === 2 ? 0.25 : 0}s` }}>
              {w.rank === 1 && <LuCrown className="wk-pod-crown" />}
              <Avatar name={w.username} seed={w.avatar} size={w.rank === 1 ? 64 : 52} />
              <span className="wk-pod-name">{w.username}</span>
              <span className="wk-points delta-up">{signed(w.delta)}</span>
              <div className="wk-pod-step">
                <span>{w.rank}</span>
              </div>
            </div>
          ))}
        </div>
        <WinnersList winners={winners} />
        <p className="muted small">{t('weekly.prizeNote')}</p>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
