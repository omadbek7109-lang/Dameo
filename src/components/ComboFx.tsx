/**
 * DAMEO Pass combo effects: when one move captures several pieces, the jumps light up one after another,
 * each captured piece gets a red ring and a burst, and a big "2x / 3x / 4+" with the effect's name pops up.
 * Double Strike plays on 2 captures, Triple Strike on 3 or more (if owned). One canvas, ~2 s, then nothing.
 */
import { useEffect, useRef } from 'react';
import { playSound } from '../services/sound.ts';

type V = { x: number; y: number };
type RGB = [number, number, number];
export type ComboTier = 'double' | 'triple';
export interface ComboShow {
  /** board squares of the start and every landing (already in screen order: 0..7 columns / rows) */
  path: V[];
  caps: V[];
  n: number;
  tier: ComboTier;
  key: string;
}

const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const PURPLE: RGB = [186, 92, 255];
const GOLD: RGB = [255, 196, 64];
const RED: RGB = [255, 60, 70];
const WHITE: RGB = [255, 255, 255];
const STEP = 0.45; // seconds per jump (slow enough to follow every capture)

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  c: RGB;
}

function crown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.55);
  ctx.lineTo(x - r, y - r * 0.35);
  ctx.lineTo(x - r * 0.5, y + r * 0.05);
  ctx.lineTo(x, y - r * 0.6);
  ctx.lineTo(x + r * 0.5, y + r * 0.05);
  ctx.lineTo(x + r, y - r * 0.35);
  ctx.lineTo(x + r, y + r * 0.55);
  ctx.closePath();
  ctx.fill();
}

export function ComboFx({ combo }: { combo: ComboShow }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    playSound(combo.tier === 'triple' ? 'combo3' : 'combo2');
    const canvas = cv.current;
    if (!canvas) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('calm')) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = rect.width / 8;
    const c = (p: V): V => ({ x: (p.x + 0.5) * S, y: (p.y + 0.5) * S });
    const pts = combo.path.map(c);
    const caps = combo.caps.map(c);
    const big = combo.tier === 'triple';
    const main: RGB = big && combo.n >= 4 ? GOLD : PURPLE;
    const jumps = pts.length - 1;
    const end = pts[pts.length - 1];
    const total = jumps * STEP + 2.2;
    const sparks: Spark[] = [];
    const burst = (p: V, n: number, col: RGB, sp: number) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2);
        const v = rnd(0.6, 1) * sp * S;
        sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - S * 0.6, life: 0, max: rnd(0.7, 1.2), size: rnd(0.04, 0.09) * S, c: Math.random() < 0.3 ? WHITE : col });
      }
    };
    const hit = new Set<number>();
    let finale = false;
    const crowns: Spark[] = [];
    let raf = 0;
    const start = performance.now();
    let last = start;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, rect.width, rect.height);
      // normal blending (not 'lighter'): the effect must also show on light boards
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.shadowColor = rgba(main, 0.9);
      ctx.shadowBlur = S * 0.3;
      // the jumps: an arc per jump, drawn one after another; they fade together at the end
      const fade = 1 - ease((t - jumps * STEP - 1.1) / 1.0);
      for (let j = 0; j < jumps; j++) {
        const k = ease((t - j * STEP) / STEP);
        if (k <= 0) continue;
        const A = pts[j];
        const B = pts[j + 1];
        const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - S * 0.9 };
        const at = (u: number): V => ({ x: (1 - u) * (1 - u) * A.x + 2 * (1 - u) * u * M.x + u * u * B.x, y: (1 - u) * (1 - u) * A.y + 2 * (1 - u) * u * M.y + u * u * B.y });
        const N = 18;
        for (let i = 0; i < N; i++) {
          const u0 = (k * i) / N;
          const u1 = (k * (i + 1)) / N;
          const f = (i + 1) / N;
          const p0 = at(u0);
          const p1 = at(u1);
          ctx.strokeStyle = rgba(mix(main, WHITE, f * 0.45), (0.45 + 0.55 * f) * fade);
          ctx.lineWidth = S * (0.12 + 0.28 * f);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        // the captured piece under this jump: red ring, then a burst when the jump passes it
        const cap = caps[j];
        if (cap) {
          const r = (t - j * STEP) / 1.4;
          if (r > 0 && r < 1) {
            ctx.strokeStyle = rgba(RED, (1 - r) * 0.95);
            ctx.lineWidth = S * 0.08;
            ctx.beginPath();
            ctx.ellipse(cap.x, cap.y + S * 0.05, S * (0.38 + 0.25 * ease(r)), S * (0.3 + 0.2 * ease(r)), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (!hit.has(j) && k > 0.5) {
            hit.add(j);
            burst(cap, 14, j % 2 ? GOLD : main, 2.2);
          }
        }
      }
      // finale on the last square
      if (!finale && t > jumps * STEP) {
        finale = true;
        burst(end, big ? 40 : 26, big ? GOLD : main, big ? 3.4 : 2.6);
        if (big) for (let i = 0; i < 3 + Math.min(2, combo.n - 3); i++) crowns.push({ x: end.x + (i - 1.5) * S * 0.4, y: end.y - S * 0.2, vx: (i - 1.5) * S * 0.3, vy: -S * rnd(1, 1.5), life: 0, max: rnd(1.2, 1.6), size: S * rnd(0.12, 0.17), c: GOLD });
      }
      const fr = (t - jumps * STEP) / 1.3;
      if (fr > 0 && fr < 1) {
        // light rays from the landing square
        const rays = big ? 10 : 7;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + t;
          ctx.strokeStyle = rgba(big ? GOLD : main, (1 - fr) * 0.55);
          ctx.lineWidth = S * 0.05;
          ctx.beginPath();
          ctx.moveTo(end.x + Math.cos(a) * S * 0.4, end.y + Math.sin(a) * S * 0.4);
          ctx.lineTo(end.x + Math.cos(a) * S * (0.6 + 1.2 * ease(fr)), end.y + Math.sin(a) * S * (0.6 + 1.2 * ease(fr)));
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      let alive = 0;
      for (const p of [...sparks, ...crowns]) {
        p.life += dt;
        if (p.life >= p.max) continue;
        alive++;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max;
        ctx.fillStyle = rgba(p.c, 1 - k);
        if (crowns.includes(p)) crown(ctx, p.x, p.y, p.size * (1 + k * 0.3));
        else {
          p.vy += S * 2 * dt;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (t < total || alive > 0) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, rect.width, rect.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo.key]);
  const big = combo.tier === 'triple';
  const tag = `${combo.n}x`;
  const name = big ? 'Triple Strike' : 'Double Strike';
  return (
    <>
      <canvas ref={cv} className="fx-canvas combo-canvas" aria-hidden="true" />
      <div key={combo.key} className={`combo-tag ${big ? 'combo-tag-gold' : ''}`} style={{ ['--d' as string]: `${(combo.path.length - 1) * STEP}s` }} aria-live="polite">
        <b>{tag}</b>
        <span>{name}</span>
      </div>
    </>
  );
}
