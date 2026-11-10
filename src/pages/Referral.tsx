import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LuCheck, LuCopy, LuGift, LuHourglass, LuSend, LuSwords, LuUserPlus, LuUsers } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useCountUp } from '../hooks/useCountUp.ts';
import { useI18n } from '../i18n/index.tsx';
import { referralLink, referralOverview, shareReferral, type ReferralOverview } from '../services/referral.ts';
import { coins } from '../services/shop.ts';
import { haptic, inTelegram } from '../services/telegram.ts';

/**
 * DAMEO Referral: my Telegram invite link (t.me/<bot>?startapp=ref_<CODE>), share/copy, stats, my friends' progress.
 * Every number comes from the server (referral_overview); coins are paid only by the server after 2 real games.
 */
export function Referral() {
  const { t, num, date } = useI18n();
  const { signedIn, mode } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<ReferralOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await referralOverview());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (signedIn && mode === 'live') void load();
  }, [signedIn, mode, load]);

  if (!signedIn) return <div className="page"><SignInPrompt text={t('ref.needAccount')} /></div>;
  if (failed) return <div className="page"><ErrorState onRetry={load} /></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  const link = referralLink(data.code);
  const shareText = t('ref.shareText');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    haptic('move');
    toast('success', t('ref.copied'));
    setTimeout(() => setCopied(false), 1800);
  };
  const share = () => {
    if (!shareReferral(link, shareText)) void copy();
    else haptic('move');
  };

  return (
    <div className="page ref-page">
      <section className="ref-hero">
        <span className="ref-coins" aria-hidden="true">
          <i>🪙</i>
          <i>🪙</i>
          <i>🪙</i>
        </span>
        <h1 className="h1 ref-title">{t('ref.title')}</h1>
        <p className="ref-sub">{t('ref.sub', { a: data.reward_join, b: data.reward_games, n: data.games_needed, t: data.reward_join + data.reward_games })}</p>
      </section>

      <section className="card ref-link" aria-label={t('ref.myLink')}>
        <span className="ref-label">{t('ref.myLink')}</span>
        <div className="ref-link-row">
          <code className="ref-url" title={link}>{link.replace('https://', '')}</code>
          <button className={`btn btn-secondary btn-sm ref-copy ${copied ? 'is-done' : ''}`} onClick={copy} aria-label={t('ref.copy')}>
            {copied ? <LuCheck /> : <LuCopy />} <span>{copied ? t('ref.copiedShort') : t('ref.copy')}</span>
          </button>
        </div>
        <button className="btn btn-primary btn-block btn-lg ref-share" onClick={share}>
          <LuSend /> {t('ref.invite')}
        </button>
        {!inTelegram && <p className="muted small ref-note">{t('ref.onlyTelegram')}</p>}
      </section>

      <section className="ref-stats" aria-label={t('ref.stats')}>
        <Stat icon={<LuUserPlus />} label={t('ref.invited')} value={data.invited} />
        <Stat icon={<LuUsers />} label={t('ref.successful')} value={data.successful} tone="ok" />
        <Stat icon={<LuHourglass />} label={t('ref.pendingCoins')} value={data.pending_coins} coin tone="wait" />
        <Stat icon={<LuGift />} label={t('ref.earned')} value={data.earned} coin tone="gold" />
      </section>

      <section className="card ref-how">
        <h2 className="h3">{t('ref.howTitle')}</h2>
        <ol className="ref-steps">
          <li>
            <span className="ref-step-n">1</span>
            <span>{t('ref.step1')}</span>
          </li>
          <li>
            <span className="ref-step-n">2</span>
            <span>{t('ref.step2', { a: data.reward_join })}</span>
          </li>
          <li>
            <span className="ref-step-n">3</span>
            <span>{t('ref.step3', { n: data.games_needed, b: data.reward_games })}</span>
          </li>
        </ol>
        <p className="muted small">{t('ref.rules')}</p>
      </section>

      <section aria-labelledby="ref-hist">
        <h2 className="h3" id="ref-hist">
          {t('ref.history')} {data.invited > 0 && <span className="muted">· {num(data.invited)}</span>}
        </h2>
        {data.friends.length === 0 ? (
          <div className="card ref-empty">
            <LuUserPlus />
            <p className="muted">{t('ref.empty')}</p>
          </div>
        ) : (
          <ul className="ref-list">
            {data.friends.map((f, i) => (
              <li key={f.username + i} className="card ref-friend">
                <Avatar name={f.username} seed={f.avatar} size={42} />
                <span className="ref-friend-main">
                  <strong>{f.username}</strong>
                  <span className="muted small">{date(new Date(f.created_at).getTime())}</span>
                  {f.status === 'pending' && <Progress games={f.games} need={data.games_needed} />}
                </span>
                <span className="ref-friend-side">
                  <span className={`ref-chip ${f.status === 'rewarded' ? 'ref-chip-ok' : 'ref-chip-gold'}`}>
                    {f.status === 'rewarded' && <LuCheck />} +{coins(f.earned)} 🪙
                  </span>
                  {f.status === 'pending' && (
                    <span className="ref-chip ref-chip-wait">
                      <LuSwords /> {f.games}/{data.games_needed}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value, coin, tone }: { icon: ReactNode; label: string; value: number; coin?: boolean; tone?: 'ok' | 'wait' | 'gold' }) {
  const v = useCountUp(0, value, 900, value > 0);
  return (
    <div className={`card ref-stat ${tone ? `ref-stat-${tone}` : ''}`}>
      <span className="ref-stat-ico" aria-hidden="true">{icon}</span>
      <strong className="ref-stat-n">
        {coin && <span aria-hidden="true">🪙 </span>}
        {coins(v)}
      </strong>
      <span className="ref-stat-label">{label}</span>
    </div>
  );
}

function Progress({ games, need }: { games: number; need: number }) {
  const { t } = useI18n();
  const pct = Math.min(100, Math.round((100 * games) / Math.max(1, need)));
  return (
    <span className="ref-prog" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={games} aria-label={t('ref.progress', { g: games, n: need })}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}
