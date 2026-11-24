import { useCallback, useEffect, useState } from 'react';
import { LuShieldAlert, LuTriangleAlert } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { FAIR_PLAY_EVENT, fairPlayStatus, type FairPlay } from '../services/online.ts';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/**
 * Fair play (0045, like Lichess playban / Chess.com sportsmanship): a warning after 3 early quits in 24 h, then a
 * playban (quick match closed 15 min → 1 h → 24 h) with the reason and a live countdown. Renders nothing when clean.
 */
export function FairPlayNotice({ delayMs = 0, onBanChange }: { delayMs?: number; onBanChange?: (banned: boolean) => void }) {
  const { t } = useI18n();
  const [fp, setFp] = useState<FairPlay | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => {
    const asked = Date.now();
    fairPlayStatus().then(
      (s) => {
        if (!s) return;
        setSkew(Date.parse(s.server_now) - (asked + Date.now()) / 2);
        setFp(s);
      },
      () => {},
    );
  }, []);
  useEffect(() => {
    const id = setTimeout(load, delayMs);
    window.addEventListener(FAIR_PLAY_EVENT, load);
    return () => {
      clearTimeout(id);
      window.removeEventListener(FAIR_PLAY_EVENT, load);
    };
  }, [load, delayMs]);
  const left = fp?.ban_until ? Date.parse(fp.ban_until) - (now + skew) : 0;
  const banned = left > 0;
  useEffect(() => {
    onBanChange?.(banned);
    if (!banned) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [banned, onBanChange]);
  if (!fp) return null;
  if (banned) {
    return (
      <div className="notice notice-danger fair-play" role="alert">
        <LuShieldAlert />
        <div>
          <strong>{t('fp.banTitle', { time: mmss(left) })}</strong>
          <p>{t('fp.banReason', { n: fp.ban_minutes ?? 15 })}</p>
          <p className="muted small">{t('fp.banNext')}</p>
        </div>
      </div>
    );
  }
  if (fp.warned) {
    return (
      <div className="notice notice-warn fair-play" role="status">
        <LuTriangleAlert />
        <div>
          <strong>{t('fp.warnTitle')}</strong>
          <p>{t('fp.warnText', { n: fp.early_24h })}</p>
        </div>
      </div>
    );
  }
  return null;
}
