/**
 * DAMEO Pass "Victory Animation": a gold crown lands with light rays, a royal ring and gold sparks over the screen,
 * then everything fades (~2.8 s). Pure CSS, no loops after it ends; nothing with reduced motion / calm mode.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/index.tsx';

const SPARKS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2;
  const r = 120 + (i % 3) * 45;
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r * 0.8), d: (i % 6) * 0.05 };
});

export function VictoryFx() {
  const { t } = useI18n();
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setOn(false), 2900);
    return () => clearTimeout(id);
  }, []);
  if (!on || typeof document === 'undefined') return null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('calm')) return null;
  return createPortal(
    <div className="vfx" aria-hidden="true">
      <div className="vfx-rays" />
      <div className="vfx-ring" />
      <img className="vfx-crown" src={new URL('pass/prem-19.webp', document.baseURI).href} alt="" />
      {SPARKS.map((p, i) => (
        <i key={i} className="vfx-spark" style={{ ['--x' as string]: `${p.x}px`, ['--y' as string]: `${p.y}px`, animationDelay: `${0.35 + p.d}s` }} />
      ))}
      <div className="vfx-text">{t('result.victory')}</div>
    </div>,
    document.body,
  );
}
