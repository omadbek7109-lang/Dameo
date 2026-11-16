import type { MouseEvent } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { openTelegramUrl } from '../services/telegram.ts';

/** Partner banner: opens the FLECT STARS bot (Telegram Stars, Premium, Gifts). Static, no animation. */
export const FLECT_STARS_BOT = 'Flect_starsBot';
const FLECT_URL = `https://t.me/${FLECT_STARS_BOT}`;
const LOGO = new URL('brand/flect-stars.webp', document.baseURI).href;

export function FlectBanner() {
  const { t } = useI18n();
  // no href: a long press must not pop up the link menu; a tap opens the bot
  const open = (e: MouseEvent) => {
    e.preventDefault();
    if (!openTelegramUrl(FLECT_URL)) window.open(FLECT_URL, '_blank', 'noopener,noreferrer');
  };
  return (
    <a
      className="flect-banner"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e as unknown as MouseEvent)}
      aria-label={t('flect.aria')}
    >
      <span className="flect-logo">
        <img src={LOGO} alt="FLECT STARS" width={320} height={269} decoding="async" />
      </span>
      <span className="flect-copy">
        <span className="flect-text">
          <span className="flect-hl-a">Telegram</span> <span className="flect-hl-b">Stars,</span> <span className="flect-hl-w">Premium</span> {t('flect.and')}{' '}
          <span className="flect-hl-c">Gifts</span> <span className="flect-rest">{t('flect.tail')}</span>
        </span>
        <span className="flect-foot">
          <span className="flect-gifts" aria-hidden="true">
            🎁<span className="flect-crown">👑</span>
          </span>
          <span className="flect-go" aria-hidden="true">
            <LuArrowRight />
          </span>
        </span>
      </span>
    </a>
  );
}
