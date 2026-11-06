import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IconType } from 'react-icons';
import { LuBot, LuChevronRight, LuCrown, LuFlame, LuGamepad2, LuHandshake, LuLock, LuMedal, LuStar, LuTrendingUp, LuTrophy, LuX, LuZap } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, navigate } from '../router.tsx';
import { achievementsMine, computeAchievements, type AchievementId, type MyAchievements, type StreakCode } from '../services/achievements.ts';
import { coins } from '../services/shop.ts';
import { playSound } from '../services/sound.ts';
import { haptic } from '../services/telegram.ts';
import type { MatchSummary, Player, RatingPoint } from '../types/models.ts';
import { EmptyState, Spinner } from './States.tsx';
import { SignInPrompt } from './ui.tsx';

export const STREAK_ICONS: Record<StreakCode, IconType> = { first_win: LuMedal, streak_3: LuFlame, streak_5: LuZap, streak_10: LuCrown };
const LOCAL_ICONS: Record<AchievementId, IconType> = {
  firstWin: LuTrophy, tenGames: LuGamepad2, streak3: LuFlame, rating1400: LuTrendingUp, beatHard: LuBot, firstDraw: LuHandshake, veteran: LuStar,
};
// the server win-streak achievements replace the old client-side "first win" and "3 in a row"
const LOCAL_SHOWN: AchievementId[] = ['tenGames', 'rating1400', 'beatHard', 'firstDraw', 'veteran'];

interface Badge {
  key: string;
  icon: IconType;
  name: string;
  desc: string;
  on: boolean;
  progress: number;
  reward?: number;
  at?: string | null;
}

function useBadges(p: Pick<Player, 'wins' | 'losses' | 'draws'>, matches: MatchSummary[], history: RatingPoint[], server: MyAchievements | null): Badge[] {
  const { t } = useI18n();
  return useMemo(() => {
    const out: Badge[] = [];
    for (const a of server?.items ?? []) {
      out.push({
        key: a.code, icon: STREAK_ICONS[a.code], name: t(`ach2.${a.code}` as TKey), desc: t(`ach2.${a.code}.desc` as TKey),
        on: !!a.unlocked_at, progress: Math.min(1, a.progress / a.need), reward: a.reward, at: a.unlocked_at,
      });
    }
    for (const a of computeAchievements(p, matches, history)) {
      if (!LOCAL_SHOWN.includes(a.id)) continue;
      out.push({ key: a.id, icon: LOCAL_ICONS[a.id], name: t(`ach.${a.id}` as TKey), desc: t(`ach.${a.id}.desc` as TKey), on: a.unlocked, progress: a.progress });
    }
    return out;
  }, [p, matches, history, server, t]);
}

/** Compact strip for the profile: small round badges + "all" link. */
export function AchievementStrip({ player, matches, history, own }: { player: Player; matches: MatchSummary[]; history: RatingPoint[]; own: boolean }) {
  const { t } = useI18n();
  const { mode } = useAuth();
  const [server, setServer] = useState<MyAchievements | null>(null);
  useEffect(() => {
    if (own && mode === 'live') achievementsMine().then(setServer, () => setServer(null));
  }, [own, mode, player.wins, player.losses]);
  const badges = useBadges(player, matches, history, server);
  const on = badges.filter((b) => b.on).length;
  const body = (
    <>
      <span className="ach-strip-head">
        <strong>{t('profile.achievements')}</strong>
        <span className="muted small">{t('profile.unlocked', { n: on, total: badges.length })}</span>
        {server && server.current_streak > 0 && (
          <span className="ach-streak-chip">
            <LuFlame /> {server.current_streak}
          </span>
        )}
        {own && <LuChevronRight className="ach-strip-go" />}
      </span>
      <span className="ach-strip-row">
        {badges.map((b) => (
          <span key={b.key} className={`ach-dot ${b.on ? 'ach-dot-on' : ''}`} title={`${b.name} — ${b.desc}`}>
            {b.on ? <b.icon /> : <LuLock />}
          </span>
        ))}
      </span>
    </>
  );
  return own ? (
    <Link to="/achievements" className="card ach-strip" aria-label={t('ach.all')}>
      {body}
    </Link>
  ) : (
    <section className="card ach-strip">{body}</section>
  );
}

/** All achievements: streak card, then every badge with progress and reward. */
export function AchievementsPage() {
  const { t, dateTime } = useI18n();
  const { me, mode, signedIn, matches, history } = useAuth();
  const [server, setServer] = useState<MyAchievements | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (mode !== 'live' || !signedIn) return setLoading(false);
    achievementsMine().then(setServer, () => setServer(null)).finally(() => setLoading(false));
  }, [mode, signedIn, me?.wins]);
  const badges = useBadges(me ?? { wins: 0, losses: 0, draws: 0 }, matches, history, server);
  if (!signedIn || !me) return <div className="page"><SignInPrompt text={t('profile.needAccount')} /></div>;
  if (loading) return <div className="page"><Spinner /></div>;
  const unlocked = badges.filter((b) => b.on);
  const locked = badges.filter((b) => !b.on);
  const card = (b: Badge) => (
    <li key={b.key} className={`ach-card ${b.on ? 'ach-card-on' : ''}`}>
      <span className="ach-card-ico">{b.on ? <b.icon /> : <LuLock />}</span>
      <span className="ach-card-main">
        <strong>{b.name}</strong>
        <span className="muted small">{b.desc}</span>
        {!b.on && (
          <span className="ach-bar" aria-label={`${Math.round(b.progress * 100)}%`}>
            <span style={{ width: `${Math.round(b.progress * 100)}%` }} />
          </span>
        )}
        {b.on && b.at && <span className="muted small">{dateTime(Date.parse(b.at))}</span>}
      </span>
      {b.reward ? <span className={`ach-reward ${b.on ? 'ach-reward-got' : ''}`}>🪙 {coins(b.reward)}</span> : null}
    </li>
  );
  return (
    <div className="page page-narrow">
      <h1 className="h1">
        <LuTrophy /> {t('ach.all')}
      </h1>
      {server && (
        <section className="card streak-card">
          <span className="streak-flame">
            <LuFlame />
          </span>
          <span className="streak-main">
            <strong>{t('ach.streakNow', { n: server.current_streak })}</strong>
            <span className="muted small">{t('ach.streakBest', { n: server.best_streak })}</span>
          </span>
        </section>
      )}
      <h2 className="h2">{t('ach.unlocked', { n: unlocked.length })}</h2>
      {unlocked.length === 0 ? <EmptyState title={t('ach.none')} /> : <ul className="ach-list">{unlocked.map(card)}</ul>}
      <h2 className="h2">{t('ach.locked', { n: locked.length })}</h2>
      <ul className="ach-list">{locked.map(card)}</ul>
    </div>
  );
}

/** End-of-game congratulations for what this game unlocked (the coins are already on the balance). */
export function AchievementUnlocked({ items, onClose }: { items: Array<{ code: StreakCode; reward: number }>; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    playSound('win');
    haptic('win');
  }, []);
  const top = [...items].sort((a, b) => b.reward - a.reward)[0];
  const Icon = STREAK_ICONS[top.code];
  const total = items.reduce((s, i) => s + i.reward, 0);
  return createPortal(
    <div className="modal-backdrop ach-pop-backdrop" role="dialog" aria-modal="true" aria-labelledby="ach-pop-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ach-pop">
        <button className="icon-btn ach-pop-x" onClick={onClose} aria-label={t('common.close')}>
          <LuX />
        </button>
        <div className="ach-pop-burst" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} style={{ ['--a' as string]: `${i * 30}deg` }} />
          ))}
        </div>
        <span className="ach-pop-ico">
          <Icon />
        </span>
        <p className="ach-pop-hello">{t('ach.congrats')} 🎉</p>
        <p className="muted">{t('ach.newOne')}</p>
        <h2 id="ach-pop-title" className="ach-pop-title">
          {t(`ach2.${top.code}` as TKey)}
        </h2>
        <p className="ach-pop-desc">{t(`ach2.${top.code}.desc` as TKey)}</p>
        {items.length > 1 && <p className="muted small">{items.filter((i) => i !== top).map((i) => t(`ach2.${i.code}` as TKey)).join(' · ')}</p>}
        <p className="ach-pop-reward">
          {t('ach.reward')}: <strong>+{coins(total)} 🪙</strong>
        </p>
        <div className="row-actions ach-pop-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              navigate('/achievements');
            }}
          >
            <LuTrophy /> {t('ach.view')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
