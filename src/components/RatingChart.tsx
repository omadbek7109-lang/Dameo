import { useMemo } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { RatingPoint } from '../types/models.ts';

/** Dependency-free SVG line chart. Colours come from CSS variables so it follows the theme. */
export function RatingChart({ points, height = 180 }: { points: RatingPoint[]; height?: number }) {
  const { t, num, date } = useI18n();
  const W = 600;
  const H = height;
  const pad = { l: 38, r: 12, t: 14, b: 32 };

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const ys = points.map((p) => p.rating);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (hi - lo < 40) {
      lo -= 20;
      hi += 20;
    }
    const margin = (hi - lo) * 0.12;
    lo = Math.floor((lo - margin) / 10) * 10;
    hi = Math.ceil((hi + margin) / 10) * 10;
    const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.rating).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - pad.b} L${x(0).toFixed(1)} ${H - pad.b} Z`;
    const ticks = [lo, Math.round((lo + hi) / 2 / 10) * 10, hi];
    return { lo, hi, x, y, line, area, ticks };
  }, [points, H]);

  if (!geo) return null;
  const last = points[points.length - 1];
  const first = points[0];
  const summary = t('chart.summary', { n: points.length, from: num(first.rating), to: num(last.rating) });
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none" className="chart-svg">
        {geo.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={geo.y(v)} y2={geo.y(v)} className="chart-grid" />
            <text x={pad.l - 6} y={geo.y(v) + 4} textAnchor="end" className="chart-label">
              {num(v)}
            </text>
          </g>
        ))}
        <path d={geo.area} className="chart-area" />
        <path d={geo.line} className="chart-line" />
        {points.length <= 40 &&
          points.map((p, i) => (
            <circle key={i} cx={geo.x(i)} cy={geo.y(p.rating)} r={i === points.length - 1 ? 4.5 : 2.5} className={i === points.length - 1 ? 'chart-dot chart-dot-last' : 'chart-dot'}>
              <title>{`${date(p.ts)} · ${num(p.rating)}`}</title>
            </circle>
          ))}
        <text x={pad.l} y={H - 8} className="chart-label">
          {date(first.ts)}
        </text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="chart-label">
          {date(last.ts)}
        </text>
      </svg>
    </figure>
  );
}
