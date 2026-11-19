/**
 * Premium move effects (the shop's "Animatsiyalar"): drawn with particles on one canvas over the board.
 * Runs ~1.2 s after a move and then stops completely (no frames while idle). Colour comes from the equipped
 * item (--fx-c), the kind from its class (fx-ripple / fx-sparkle / fx-fire / fx-lightning / fx-stardust).
 * Off with reduced motion and html.calm (the CSS burst stays as the light fallback there).
 */
import { useEffect, useRef } from 'react';

type Kind = 'ripple' | 'sparkle' | 'fire' | 'lightning' | 'stardust';
type V = { x: number; y: number };
interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue?: number;
  spin?: number;
  a?: number;
  r?: number;
  delay?: number;
  c?: [number, number, number];
}

const DUR: Record<Kind, number> = { ripple: 1.3, sparkle: 1.3, fire: 1.4, lightning: 1.0, stardust: 1.6 };
export const kindOf = (cls: string): Kind | null => (cls.match(/(?:^|\s)fx-(ripple|sparkle|fire|lightning|stardust)(?:\s|$)/)?.[1] as Kind) ?? null;

function rgbOf(css: string, fallback: [number, number, number]): [number, number, number] {
  const c = document.createElement('canvas').getContext('2d');
  if (!c || !css) return fallback;
  c.fillStyle = '#000';
  c.fillStyle = css.trim();
  const v = c.fillStyle as string;
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/\d+(\.\d+)?/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : fallback;
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.28;
    ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function bolt(a: V, b: V, rough: number, depth: number): V[] {
  if (depth === 0) return [a, b];
  const m = { x: (a.x + b.x) / 2 + rnd(-rough, rough), y: (a.y + b.y) / 2 + rnd(-rough, rough) * 0.4 };
  return [...bolt(a, m, rough / 2, depth - 1).slice(0, -1), ...bolt(m, b, rough / 2, depth - 1)];
}

export function FxCanvas({ fxClass, from, to, trigger }: { fxClass: string; from: V; to: V; trigger: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = cv.current;
    const kind = kindOf(fxClass);
    if (!canvas || !kind || !trigger) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('calm')) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = rect.width / 8; // one square
    const A = { x: (from.x + 0.5) * S, y: (from.y + 0.5) * S };
    const B = { x: (to.x + 0.5) * S, y: (to.y + 0.5) * S };
    const defaults: Record<Kind, [number, number, number]> = { ripple: [79, 195, 247], sparkle: [255, 213, 79], fire: [255, 87, 34], lightning: [128, 216, 255], stardust: [179, 136, 255] };
    const col = rgbOf(probe.current ? getComputedStyle(probe.current).getPropertyValue('--fx-c') : '', defaults[kind]);
    const white: [number, number, number] = [255, 255, 255];
    const ps: P[] = [];
    const dur = DUR[kind];

    // ---------- set-up per kind
    if (kind === 'sparkle') {
      for (let i = 0; i < 46; i++) {
        const ang = rnd(0, Math.PI * 2);
        const sp = rnd(1.4, 4.6) * S;
        ps.push({ x: B.x, y: B.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - S * 1.2, life: 0, max: rnd(0.7, 1.2), size: rnd(0.12, 0.24) * S, spin: rnd(-6, 6), a: rnd(0, 6) });
      }
      for (let i = 0; i < 12; i++) {
        const k = i / 11;
        ps.push({ x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, vx: 0, vy: -S * 0.3, life: 0, max: 0.6, size: rnd(0.08, 0.14) * S, spin: 3, a: 0, delay: k * 0.18 });
      }
    } else if (kind === 'fire') {
      for (let i = 0; i < 80; i++)
        ps.push({ x: B.x + rnd(-0.32, 0.32) * S, y: B.y + rnd(0, 0.3) * S, vx: rnd(-0.25, 0.25) * S, vy: -rnd(1.2, 2.6) * S, life: 0, max: rnd(0.55, 1.05), size: rnd(0.26, 0.46) * S, delay: rnd(0, 0.35) });
      for (let i = 0; i < 26; i++) {
        const k = Math.random();
        ps.push({ x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, vx: rnd(-0.4, 0.4) * S, vy: -rnd(0.4, 1.2) * S, life: 0, max: rnd(0.5, 0.9), size: rnd(0.05, 0.09) * S, delay: k * 0.2, r: 1 });
      }
    } else if (kind === 'stardust') {
      for (let i = 0; i < 70; i++)
        ps.push({ x: B.x, y: B.y, vx: 0, vy: 0, life: 0, max: rnd(0.9, 1.45), size: rnd(0.07, 0.15) * S, a: rnd(0, Math.PI * 2), r: rnd(0.15, 0.4) * S, spin: rnd(3.5, 6.5) * (i % 2 ? 1 : -1), delay: rnd(0, 0.25), c: mix(col, white, rnd(0, 0.6)) });
    } else if (kind === 'ripple') {
      for (let i = 0; i < 16; i++) {
        const ang = rnd(0, Math.PI * 2);
        const sp = rnd(1.4, 2.6) * S;
        ps.push({ x: B.x, y: B.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - S * 1.5, life: 0, max: rnd(0.5, 0.8), size: rnd(0.06, 0.1) * S });
      }
    } else if (kind === 'lightning') {
      for (let i = 0; i < 30; i++) {
        const ang = rnd(0, Math.PI * 2);
        const sp = rnd(2, 5.5) * S;
        ps.push({ x: B.x, y: B.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rnd(0.3, 0.6), size: rnd(0.035, 0.06) * S, delay: i < 15 ? 0.05 : 0.33 });
      }
    }
    const bolts =
      kind === 'lightning'
        ? [0.05, 0.33].map((t0) => {
            const top = { x: B.x + rnd(-1.2, 1.2) * S, y: Math.min(B.y - 3 * S, -S * 0.5) };
            const main = bolt(top, B, S * 1.6, 6);
            const br = main[Math.floor(main.length * rnd(0.3, 0.6))];
            return { t0, main, branch: bolt(br, { x: br.x + rnd(-1.5, 1.5) * S, y: br.y + rnd(0.6, 1.4) * S }, S * 0.6, 4) };
          })
        : [];

    let raf = 0;
    const start = performance.now();
    let last = start;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;

      // ---------- glows / rings / bolts
      if (kind === 'ripple') {
        for (let i = 0; i < 3; i++) {
          const k = (t - i * 0.15) / 1.0;
          if (k <= 0 || k >= 1) continue;
          const rr = S * (0.3 + k * 1.6);
          const g = ctx.createRadialGradient(B.x, B.y, rr * 0.85, B.x, B.y, rr);
          g.addColorStop(0, rgba(col, 0));
          g.addColorStop(0.55, rgba(col, 0.9 * (1 - k)));
          g.addColorStop(1, rgba(white, (1 - k)));
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(B.x, B.y, rr, rr * 0.92, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        const f = Math.max(0, 1 - t / 0.35);
        if (f > 0) {
          const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, S * 0.7);
          g.addColorStop(0, rgba(white, 0.7 * f));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(B.x - S, B.y - S, S * 2, S * 2);
        }
      }
      if (kind === 'sparkle') {
        const f = Math.max(0, 1 - t / 0.45);
        if (f > 0) {
          ctx.save();
          ctx.translate(B.x, B.y);
          ctx.rotate(t * 2);
          for (const L of [S * 1.4, S * 0.9]) {
            const g = ctx.createLinearGradient(-L, 0, L, 0);
            g.addColorStop(0, rgba(col, 0));
            g.addColorStop(0.5, rgba(white, f));
            g.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = g;
            ctx.fillRect(-L, -S * 0.025, L * 2, S * 0.05);
            ctx.rotate(Math.PI / 2);
          }
          ctx.restore();
          const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, S * 0.8);
          g.addColorStop(0, rgba(col, 0.6 * f));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(B.x - S, B.y - S, S * 2, S * 2);
        }
      }
      if (kind === 'fire') {
        const f = Math.min(1, t / 0.15) * Math.max(0, 1 - t / dur);
        const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, S * 1.1);
        g.addColorStop(0, rgba(mix(col, [255, 220, 120], 0.5), 0.55 * f));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(B.x - S * 1.2, B.y - S * 1.2, S * 2.4, S * 2.4);
      }
      if (kind === 'stardust') {
        // comet from the start square
        const k = Math.min(1, t / 0.35);
        if (t < 0.55) {
          const hx = A.x + (B.x - A.x) * k;
          const hy = A.y + (B.y - A.y) * k;
          const g = ctx.createLinearGradient(A.x, A.y, hx, hy);
          g.addColorStop(0, rgba(col, 0));
          g.addColorStop(1, rgba(white, 0.9 * (1 - Math.max(0, t - 0.35) / 0.2)));
          ctx.strokeStyle = g;
          ctx.lineWidth = S * 0.08;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
        const f = Math.min(1, Math.max(0, (t - 0.25) / 0.2)) * Math.max(0, 1 - (t - 0.3) / (dur - 0.3));
        const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, S * 1.2);
        g.addColorStop(0, rgba(white, 0.35 * f));
        g.addColorStop(0.35, rgba(col, 0.4 * f));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(B.x - S * 1.3, B.y - S * 1.3, S * 2.6, S * 2.6);
      }
      if (kind === 'lightning') {
        for (const bl of bolts) {
          const k = (t - bl.t0) / 0.3;
          if (k < 0 || k > 1) continue;
          const a = (1 - k) * (k < 0.15 ? 1 : 0.8 + 0.2 * Math.sin(t * 90));
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.shadowColor = rgba(col, 1);
          ctx.shadowBlur = S * 0.35;
          for (const [w, c, al] of [
            [S * 0.3, col, 0.3],
            [S * 0.12, col, 0.85],
            [S * 0.045, white, 1],
          ] as Array<[number, [number, number, number], number]>) {
            ctx.strokeStyle = rgba(c, al * a);
            ctx.lineWidth = w;
            ctx.lineJoin = 'round';
            for (const path of [bl.main, bl.branch]) {
              ctx.beginPath();
              path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
              ctx.stroke();
            }
          }
          ctx.restore();
          const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, S * 1.6);
          g.addColorStop(0, rgba(white, 0.6 * a));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(B.x - S * 2, B.y - S * 2, S * 4, S * 4);
          ctx.fillStyle = rgba(col, 0.08 * a); // board flash
          ctx.fillRect(0, 0, rect.width, rect.height);
        }
      }

      // ---------- particles: normal blending + glow, so they read on light boards as well as dark ones
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowColor = rgba(col, 0.95);
      ctx.shadowBlur = S * 0.22;
      let alive = 0;
      for (const p of ps) {
        if (p.delay && t < p.delay) {
          alive++;
          continue;
        }
        p.life += dt;
        if (p.life >= p.max) continue;
        alive++;
        const k = p.life / p.max;
        if (kind === 'stardust') {
          p.a! += p.spin! * dt;
          p.r! += S * 0.9 * dt;
          p.x = B.x + Math.cos(p.a!) * p.r!;
          p.y = B.y + Math.sin(p.a!) * p.r! * 0.8;
          const tw = 0.6 + 0.4 * Math.sin((p.life + p.a!) * 18);
          ctx.fillStyle = rgba(p.c!, (1 - k) * tw);
          star(ctx, p.x, p.y, p.size * (1.2 - k * 0.5), p.a!);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (kind === 'sparkle') {
          p.vy += S * 6 * dt;
          p.vx *= 0.97;
          p.a! += p.spin! * dt;
          const tw = 0.55 + 0.45 * Math.sin(p.life * 30 + p.a!);
          ctx.fillStyle = rgba(mix(col, white, 0.35), (1 - k) * tw);
          star(ctx, p.x, p.y, p.size * (1 - k * 0.4), p.a!);
        } else if (kind === 'fire') {
          if (p.r) {
            p.vy += S * 0.8 * dt;
            ctx.fillStyle = rgba(mix([255, 230, 150], col, k), 1 - k);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          } else {
            p.vx += Math.sin(p.life * 20 + p.x) * S * 0.6 * dt;
            const c = k < 0.25 ? mix([255, 250, 220], [255, 214, 90], k / 0.25) : k < 0.6 ? mix([255, 214, 90], col, (k - 0.25) / 0.35) : mix(col, [90, 10, 0], (k - 0.6) / 0.4);
            const rr = p.size * (1 - k * 0.7);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
            g.addColorStop(0, rgba(c, 0.85 * (1 - k)));
            g.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = g;
            ctx.fillRect(p.x - rr, p.y - rr, rr * 2, rr * 2);
          }
        } else if (kind === 'ripple') {
          p.vy += S * 7 * dt;
          ctx.fillStyle = rgba(mix(col, white, 0.5), 1 - k);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else if (kind === 'lightning') {
          p.vx *= 0.9;
          p.vy *= 0.9;
          ctx.strokeStyle = rgba(mix(col, white, 0.6), 1 - k);
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
        }
      }
      if (t < dur || alive > 0) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, rect.width, rect.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return (
    <>
      <span ref={probe} className={`fx-probe ${fxClass}`} aria-hidden="true" />
      <canvas ref={cv} className="fx-canvas" aria-hidden="true" />
    </>
  );
}
