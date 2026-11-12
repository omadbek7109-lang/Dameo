/**
 * Virtual opponents: how they choose a move and how long they "think" (server side, in match-action).
 *
 *  - Strength = the opponent's level (beginner / normal / pro), nudged per move by the position and the player's rating:
 *    clearly ahead → sometimes plays a step weaker, clearly behind → sometimes a step stronger, so long-run results drift
 *    towards ~50/50 without any scripted win/loss. The rules are never bent: the move is a legal engine move.
 *  - Thinking time depends on the time control (1 / 3 / 5 min), on how complex the position is (forced move, captures,
 *    many options) and on the opponent's temperament (style). It is random within ranges, never the same second twice,
 *    and normally a small share of the remaining clock — but in fast games a long think can occasionally flag the bot.
 */
import { chooseMove, type Difficulty } from './ai.ts';
import { legalMovesFor } from '../engine/rules.ts';
import type { GameState, Move } from '../engine/types.ts';

export type VirtualLevel = 'beginner' | 'normal' | 'pro';
export type VirtualStyle = 'aggressive' | 'solid' | 'tricky' | 'calm' | 'fast';
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
const BASE: Record<VirtualLevel, number> = { beginner: 0, normal: 1, pro: 2 };
/** search budget (ms) per engine level and time control */
// (60 = the removed 1-minute mode, kept only so a game already running at deploy time finishes normally)
const SEARCH: Record<number, [number, number, number]> = { 60: [60, 160, 300], 180: [90, 300, 550], 300: [110, 380, 750], 480: [130, 450, 900] };
/** base thinking range (ms) per time control for an ordinary position */
const THINK: Record<number, [number, number]> = { 60: [700, 2300], 180: [1100, 3600], 300: [1500, 5200], 480: [1900, 6800] };
const STYLE_TEMPO: Record<VirtualStyle, number> = { fast: 0.62, aggressive: 0.88, tricky: 1, solid: 1.12, calm: 1.32 };

export interface PlanInput {
  state: GameState;
  level: VirtualLevel;
  style: VirtualStyle;
  /** 180 | 300 | 480 */
  timeControl: number;
  /** the bot's remaining clock (ms) */
  botMs: number;
  /** the human's rating */
  humanRating: number;
  random?: () => number;
}
export interface Plan {
  move: Move;
  thinkMs: number;
  engineLevel: Difficulty;
}

/** material from the side to move's point of view (man = 1, king = 3) */
export function material(state: GameState): number {
  let s = 0;
  for (const c of state.board) {
    if (c === 0) continue;
    const v = c === 2 || c === -2 ? 3 : 1;
    s += (c > 0) === (state.turn === 'w') ? v : -v;
  }
  return s;
}

export function effectiveLevel(level: VirtualLevel, style: VirtualStyle, mat: number, humanRating: number, rnd: () => number): number {
  let i = BASE[level];
  if (mat >= 2 && rnd() < (style === 'aggressive' ? 0.3 : 0.5)) i--; // comfortable lead → relaxes
  if (mat <= -2 && rnd() < 0.5) i++; // behind → concentrates
  if (humanRating < 1100 && rnd() < 0.4) i--;
  if (humanRating > 1450 && rnd() < 0.4) i++;
  return Math.max(0, Math.min(2, i));
}

export function thinkTime(opts: { timeControl: number; style: VirtualStyle; legal: number; captures: boolean; botMs: number; moveNo: number }, rnd: () => number): number {
  const tc = THINK[opts.timeControl] ? opts.timeControl : 180;
  const [lo, hi] = THINK[tc];
  let t: number;
  if (opts.legal <= 1) t = 350 + rnd() * 850; // forced move: quick, but not instant
  else {
    t = lo + rnd() * (hi - lo);
    if (opts.captures && opts.legal > 1) t *= 1.15 + rnd() * 0.35; // choosing between captures
    if (opts.legal >= 9 && tc >= 180) t *= 1.15 + rnd() * 0.6; // rich position: calculates longer
    if (opts.moveNo < 4) t *= 0.55 + rnd() * 0.3; // opening moves come quickly
    if (opts.style === 'tricky') t *= 0.6 + rnd() * 0.9; // unpredictable tempo
  }
  t *= STYLE_TEMPO[opts.style];
  t += rnd() * 240 - 120; // never the same second
  // keep within a sensible share of the remaining clock — except, rarely, in fast games (a bot can flag too)
  const overthink = tc === 60 && opts.botMs < 20_000 && opts.legal > 1 && rnd() < 0.06;
  if (overthink) t = Math.max(t, opts.botMs * (0.75 + rnd() * 0.5)); // gets lost in calculation
  const cap = overthink ? Math.min(28_000, opts.botMs + 2_000) : Math.max(300, Math.min(26_000, opts.botMs * (tc === 60 ? 0.12 : 0.1)));
  return Math.round(Math.max(300, Math.min(t, cap)));
}

export function planVirtualMove(inp: PlanInput): Plan | null {
  const rnd = inp.random ?? Math.random;
  const moves = legalMovesFor(inp.state.board, inp.state.turn);
  if (moves.length === 0) return null;
  const lvlIdx = effectiveLevel(inp.level, inp.style, material(inp.state), inp.humanRating, rnd);
  const engineLevel = LEVELS[lvlIdx];
  const budget = (SEARCH[inp.timeControl] ?? SEARCH[180])[lvlIdx];
  const move = chooseMove(inp.state, engineLevel, { timeMs: budget, random: rnd });
  if (!move) return null;
  const thinkMs = thinkTime(
    { timeControl: inp.timeControl, style: inp.style, legal: moves.length, captures: moves.some((m) => m.captures.length > 0), botMs: inp.botMs, moveNo: inp.state.history.length },
    rnd,
  );
  return { move, thinkMs, engineLevel };
}
