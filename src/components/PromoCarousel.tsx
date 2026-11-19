import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { openTelegramUrl } from '../services/telegram.ts';
import { FlectBanner } from './FlectBanner.tsx';

const BOOKLY_URL = 'https://t.me/Booklym_app_Bot';
const SLIDES = 2;
const EVERY_MS = 4500;

/** Bookly ad: "create your own book" — art is drawn in CSS/SVG, no image download. */
function BooklyBanner() {
  const { t } = useI18n();
  const open = (e: MouseEvent) => {
    if (openTelegramUrl(BOOKLY_URL)) e.preventDefault();
  };
  return (
    <a className="bookly-banner" href={BOOKLY_URL} target="_blank" rel="noopener noreferrer" onClick={open} aria-label={t('bookly.aria')}>
      <span className="bookly-art" aria-hidden="true">
        <svg viewBox="0 0 120 90" className="bookly-book">
          <defs>
            <linearGradient id="bkL" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff7e6" />
              <stop offset="1" stopColor="#f3d9a8" />
            </linearGradient>
            <linearGradient id="bkC" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2dd4bf" />
              <stop offset="1" stopColor="#0f766e" />
            </linearGradient>
          </defs>
          <path d="M8 22 Q34 12 60 24 Q86 12 112 22 L112 80 Q86 70 60 82 Q34 70 8 80 Z" fill="url(#bkC)" />
          <path d="M13 20 Q36 11 58 22 L58 76 Q36 66 13 74 Z" fill="url(#bkL)" />
          <path d="M107 20 Q84 11 62 22 L62 76 Q84 66 107 74 Z" fill="url(#bkL)" />
          <g stroke="#c9a46a" strokeWidth="2" strokeLinecap="round" opacity="0.8">
            <path d="M20 32 Q36 26 51 32" />
            <path d="M20 41 Q36 35 51 41" />
            <path d="M20 50 Q36 44 46 49" />
            <path d="M69 32 Q84 26 100 32" />
            <path d="M69 41 Q84 35 100 41" />
          </g>
          <path d="M92 6 L96 16 L106 18 L96 21 L92 31 L88 21 L78 18 L88 16 Z" fill="#fde047" />
        </svg>
      </span>
      <span className="bookly-copy">
        <span className="bookly-name">Bookly</span>
        <span className="bookly-title">{t('bookly.title')}</span>
        <span className="bookly-foot">
          <span className="bookly-sub">{t('bookly.sub')}</span>
          <span className="flect-go bookly-go" aria-hidden="true">
            <LuArrowRight />
          </span>
        </span>
      </span>
    </a>
  );
}

/** Top-of-Arena ads: swipeable, auto-advances every few seconds, pauses while touched. */
export function PromoCarousel() {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const paused = useRef(false);

  // which slide is in view (follows finger swipes too)
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const on = () => setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      const el = track.current;
      if (!el || paused.current || document.hidden) return;
      const next = (Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) + 1) % SLIDES;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  const hold = () => (paused.current = true);
  const release = () => window.setTimeout(() => (paused.current = false), 2500);

  return (
    <section className="promo" aria-roledescription="carousel" aria-label={t('home.promo')}>
      <div className="promo-track" ref={track} onPointerDown={hold} onPointerUp={release} onPointerCancel={release} onTouchStart={hold} onTouchEnd={release}>
        <div className="promo-slide" aria-roledescription="slide" aria-label="1 / 2">
          <FlectBanner />
        </div>
        <div className="promo-slide" aria-roledescription="slide" aria-label="2 / 2">
          <BooklyBanner />
        </div>
      </div>
      <div className="promo-dots">
        {Array.from({ length: SLIDES }, (_, i) => (
          <button key={i} type="button" className={`promo-dot ${idx === i ? 'promo-dot-on' : ''}`} onClick={() => go(i)} aria-label={`${i + 1} / ${SLIDES}`} aria-current={idx === i} />
        ))}
      </div>
    </section>
  );
}
