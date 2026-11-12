import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LuBot, LuCalendarCheck, LuCheck, LuClock, LuFlame, LuGift, LuLoader, LuMedal, LuSend, LuShieldCheck, LuSwords, LuTrophy, LuUserPlus } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, navigate, useRoute } from '../router.tsx';
import {
  channelAvatar,
  channelCheck,
  channelClaim,
  missionClaim,
  missionsOverview,
  type ChannelState,
  type MissionChannel,
  type MissionRow,
  type MissionsOverview,
} from '../services/missions.ts';
import { coins } from '../services/shop.ts';
import { appActive, haptic, tg } from '../services/telegram.ts';
import { splitDuration } from '../services/weekly.ts';

type Tab = 'daily' | 'once';
const DAILY_ICON: Record<string, ReactNode> = {
  d_wins3: <LuTrophy />,
  d_invite: <LuUserPlus />,
  d_bot_medium: <LuBot />,
  d_streak3: <LuFlame />,
  d_games5: <LuSwords />,
  d_bonus: <LuGift />,
};
const DAILY_GO: Record<string, { to: string; key: TKey }> = {
  d_wins3: { to: '/play?mode=quick', key: 'ms.goPlay' },
  d_invite: { to: '/referral', key: 'ms.goInvite' },
  d_bot_medium: { to: '/play?mode=practice', key: 'ms.goBot' },
  d_streak3: { to: '/play?mode=quick', key: 'ms.goPlay' },
  d_games5: { to: '/play?mode=quick', key: 'ms.goPlay' },
};

/** Missions: daily (reset 00:00 Tashkent) and one-time (incl. Telegram channels). Every reward is claimed with "Olish". */
export function Missions() {
  const { t } = useI18n();
  const { signedIn, mode } = useAuth();
  const { query } = useRoute();
  const tab: Tab = query.get('tab') === 'once' ? 'once' : 'daily';
  const { toast } = useToast();
  const [ov, setOv] = useState<MissionsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0);

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const o = await missionsOverview();
      const s = Date.parse(o.server_now);
      if (Number.isFinite(s)) skew.current = s - (t0 + Date.now()) / 2;
      setOv(o);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (signedIn && mode === 'live') void load();
  }, [signedIn, mode, load]);
  // countdown + reload at midnight / when the app comes back
  useEffect(() => {
    const id = setInterval(() => appActive() && setNow(Date.now()), 1000);
    const onWake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [load]);
  const left = ov ? Date.parse(ov.resets_at) - skew.current - now : 0;
  const rolled = useRef<string | null>(null);
  useEffect(() => {
    if (ov && left <= 0 && rolled.current !== ov.day) {
      rolled.current = ov.day;
      setTimeout(() => void load(), 1500);
    }
  }, [left, ov, load]);

  if (!signedIn || mode !== 'live') return <div className="page"><SignInPrompt text={t('ref.needAccount')} /></div>;
  if (failed && !ov) return <div className="page"><ErrorState onRetry={load} /></div>;
  if (!ov) return <div className="page"><Spinner /></div>;

  const claim = async (key: string) => {
    setBusy(key);
    try {
      const r = await missionClaim(key);
      if (r.ok) {
        haptic('win');
        toast('success', t('ms.claimedToast', { n: r.coins }));
      } else toast('error', t(r.reason === 'claimed' ? 'ms.err.claimed' : r.reason === 'not-done' ? 'ms.err.notDone' : 'ms.err.generic'));
    } catch {
      toast('error', t('ms.err.generic'));
    } finally {
      setBusy(null);
      void load();
    }
  };

  const doneN = ov.daily.filter((m) => m.key !== 'd_bonus' && m.done).length;
  const dailyMax = ov.daily.reduce((s, m) => s + m.reward, 0);
  const cd = splitDuration(left);
  const setTab = (x: Tab) => navigate(x === 'daily' ? '/missions' : '/missions?tab=once');

  return (
    <div className="page ms-page">
      <section className="ms-hero">
        <div>
          <h1 className="h1">{t('ms.title')}</h1>
          <p className="muted">{t('ms.sub')}</p>
        </div>
        <Link to="/wallet" className="ms-balance" aria-label={t('ms.balance')}>
          <span aria-hidden="true">🪙</span> <strong>{coins(ov.balance)}</strong>
        </Link>
      </section>

      <div className="tabs ms-tabs" role="tablist">
        {(['daily', 'once'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={`tab ${tab === x ? 'tab-active' : ''}`} onClick={() => setTab(x)}>
            {t(x === 'daily' ? 'ms.tabDaily' : 'ms.tabOnce')}
            {x === 'once' && ov.once.length + ov.channels.length > 0 && <span className="tab-count">{ov.once.length + ov.channels.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'daily' ? (
        <>
          <div className="card ms-reset">
            <span className="ms-reset-ico" aria-hidden="true">
              <LuClock />
            </span>
            <span className="ms-reset-main">
              <span className="muted small">{t('ms.resetsIn')}</span>
              <strong className="ms-reset-time" role="timer">
                {String(cd.d * 24 + cd.h).padStart(2, '0')}:{String(cd.m).padStart(2, '0')}:{String(cd.s).padStart(2, '0')}
              </strong>
            </span>
            <span className="ms-reset-sum">
              <span className="ms-dots" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={i < doneN ? 'on' : ''} />
                ))}
              </span>
              <span className="muted small">{t('ms.dailySummary', { d: doneN, c: dailyMax })}</span>
            </span>
          </div>
          <ul className="ms-list">
            {ov.daily.map((m) => (
              <MissionCard
                key={m.key}
                m={m}
                icon={DAILY_ICON[m.key]}
                title={t(`ms.${m.key}` as TKey)}
                desc={t(`ms.${m.key}.d` as TKey)}
                bonus={m.key === 'd_bonus'}
                busy={busy === m.key}
                onClaim={() => claim(m.key)}
                go={DAILY_GO[m.key]}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          {ov.channels.length > 0 && (
            <section aria-labelledby="ms-ch">
              <h2 className="h3 ms-h" id="ms-ch">
                <LuSend /> {t('ms.channels')}
              </h2>
              <ul className="ms-list">
                {ov.channels.map((c) => (
                  <ChannelCard key={c.id} c={c} hasTelegram={ov.has_telegram} onDone={load} />
                ))}
              </ul>
            </section>
          )}
          {ov.once.length > 0 && (
            <ul className="ms-list">
              {ov.once.map((m) => {
                const wins = m.key.startsWith('o_wins');
                return (
                  <MissionCard
                    key={m.key}
                    m={m}
                    icon={wins ? <LuMedal /> : <LuCalendarCheck />}
                    title={t(wins ? 'ms.o_wins' : 'ms.o_games', { n: m.target })}
                    desc={t(wins ? 'ms.o_wins.d' : 'ms.o_games.d', { n: m.target })}
                    busy={busy === m.key}
                    onClaim={() => claim(m.key)}
                    go={{ to: '/play?mode=quick', key: 'ms.goPlay' }}
                  />
                );
              })}
            </ul>
          )}
          {ov.once.length === 0 && ov.channels.length === 0 && <p className="card ms-alldone">{t('ms.allOnceDone')}</p>}
          {ov.history.length > 0 && (
            <section aria-labelledby="ms-hist">
              <h2 className="h3 ms-h" id="ms-hist">
                <LuShieldCheck /> {t('ms.history')}
              </h2>
              <ul className="ms-hist">
                {ov.history.map((h) => (
                  <li key={h.mission}>
                    <LuCheck className="ms-hist-ok" />
                    <span>{historyTitle(h.mission, h.title, t)}</span>
                    <strong>+{coins(h.reward)} 🪙</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="muted small ms-note">{t('ms.validNote')}</p>
    </div>
  );
}

function historyTitle(key: string, title: string | null, t: ReturnType<typeof useI18n>['t']) {
  if (key.startsWith('channel:')) return `${t('ms.channelMission')}${title ? ` — ${title}` : ''}`;
  const n = Number(key.replace(/\D/g, ''));
  return t(key.startsWith('o_wins') ? 'ms.o_wins' : 'ms.o_games', { n });
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((100 * value) / Math.max(1, max)));
  return (
    <span className="ms-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

function MissionCard({ m, icon, title, desc, bonus, busy, onClaim, go }: { m: MissionRow; icon: ReactNode; title: string; desc: string; bonus?: boolean; busy: boolean; onClaim: () => void; go?: { to: string; key: TKey } }) {
  const { t } = useI18n();
  const state = m.claimed ? 'claimed' : m.done ? 'ready' : 'progress';
  return (
    <li className={`card ms-card ms-${state} ${bonus ? 'ms-bonus' : ''}`}>
      <span className="ms-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="ms-main">
        <span className="ms-top">
          <strong className="ms-title">{title}</strong>
          <span className="ms-reward">+{coins(m.reward)} 🪙</span>
        </span>
        <span className="ms-desc">{desc}</span>
        <span className="ms-prog">
          <Bar value={m.progress} max={m.target} />
          <span className="ms-count">
            {m.progress}/{m.target}
          </span>
        </span>
      </span>
      <span className="ms-act">
        {state === 'claimed' ? (
          <span className="ms-chip-ok">
            <LuCheck /> {t('ms.claimed')}
          </span>
        ) : state === 'ready' ? (
          <button className="btn btn-primary btn-sm ms-claim" onClick={onClaim} disabled={busy}>
            {busy ? <LuLoader className="spin" /> : <LuGift />} {t('ms.claim')}
          </button>
        ) : go ? (
          <Link to={go.to} className="btn btn-secondary btn-sm">
            {t(go.key)}
          </Link>
        ) : (
          <span className="muted small">{t('ms.inProgress')}</span>
        )}
      </span>
    </li>
  );
}

function ChannelCard({ c, hasTelegram, onDone }: { c: MissionChannel; hasTelegram: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState<ChannelState | 'checking' | null>(c.verified ? 'member' : hasTelegram ? null : 'no-telegram');
  const [busy, setBusy] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const waiting = useRef(false);

  const check = useCallback(async (quiet = false) => {
    if (!hasTelegram) return;
    if (!quiet) setState('checking');
    try {
      const r = await channelCheck(c.id);
      setState(r.state);
      if (r.state === 'member') waiting.current = false;
      if (r.state === 'claimed') onDone();
    } catch {
      setState('error');
    }
  }, [c.id, hasTelegram, onDone]);

  // verify immediately when the mission is opened (already subscribed → "Olish" right away)
  useEffect(() => {
    if (!c.verified) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // after "subscribe": verify when the player comes back to the app, and a few times meanwhile
  useEffect(() => {
    const onBack = () => waiting.current && document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onBack);
    tg?.onEvent?.('activated', onBack);
    const id = setInterval(() => waiting.current && appActive() && void check(true), 4000);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      tg?.offEvent?.('activated', onBack);
      clearInterval(id);
    };
  }, [check]);

  const open = () => {
    if (!c.link) return;
    waiting.current = true;
    haptic('move');
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(c.link);
      else window.open(c.link, '_blank', 'noopener');
    } catch {
      window.open(c.link, '_blank', 'noopener');
    }
  };
  const claim = async () => {
    setBusy(true);
    try {
      const r = await channelClaim(c.id);
      if (r.state === 'claimed' && r.coins) {
        haptic('win');
        toast('success', t('ms.channelToast', { n: r.coins }));
        onDone();
      } else if (r.state === 'claimed') onDone();
      else setState(r.state);
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  };

  const avatar = channelAvatar(c.username);
  const member = state === 'member';
  return (
    <li className={`card ms-card ms-channel ${member ? 'ms-ready' : 'ms-progress'}`}>
      <span className="ms-ch-ava" aria-hidden="true">
        {avatar && imgOk ? <img src={avatar} alt="" loading="lazy" onError={() => setImgOk(false)} /> : <span>{c.title.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="ms-main">
        <span className="ms-top">
          <strong className="ms-title">{c.title}</strong>
          <span className="ms-reward">+{coins(c.reward)} 🪙</span>
        </span>
        <span className="ms-desc">
          {t('ms.channelMission')}
          {c.username ? ` · @${c.username}` : ''}
        </span>
        <span className={`ms-ch-status ${member ? 'is-ok' : ''}`} role="status">
          {state === 'checking' && (
            <>
              <LuLoader className="spin" /> {t('ms.checking')}
            </>
          )}
          {member && (
            <>
              <LuCheck /> {t('ms.verified')}
            </>
          )}
          {state === 'not_member' && t('ms.notMember')}
          {(state === 'unavailable' || state === 'error' || state === 'inactive') && t('ms.unavailable')}
          {state === 'no-telegram' && t('ms.noTelegram')}
        </span>
      </span>
      <span className="ms-act ms-ch-act">
        {member ? (
          <button className="btn btn-primary btn-sm ms-claim" onClick={claim} disabled={busy}>
            {busy ? <LuLoader className="spin" /> : <LuGift />} {t('ms.claim')}
          </button>
        ) : state !== 'no-telegram' ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={open} disabled={!c.link}>
              <LuSend /> {t('ms.subscribe')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void check()} disabled={state === 'checking'}>
              {t('ms.check')}
            </button>
          </>
        ) : null}
      </span>
    </li>
  );
}
