/**
 * DAMEO computer opponent.
 *
 *  - easy:   mostly random legal moves, occasionally a 1-ply greedy choice.
 *  - medium: negamax + alpha-beta, depth 3, with a little randomness among
 *            near-equal moves so games differ.
 *  - hard:   iterative-deepening negamax + alpha-beta with move ordering and
 *            a capture-extension, limited by a time budget (default 700 ms).
 */
import { applyToBoard, colorOf, isKing, legalMovesFor, rc } from '../engine/rules.ts';
import type { Cell, Color, GameState, Move } from '../engine/types.ts';

export type Difficulty = 'easy' | 'medium' | 'hard';
export interface BotOptions {
  timeMs?: number;
  /** injectable RNG for deterministic tests */
  random?: () => number;
}

const MAN = 100;
const KING = 320;
const WIN = 100000;

function evaluate(board: Cell[], me: Color): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const cell = board[i];
    if (cell === 0) continue;
    const color = colorOf(cell)!;
    const [r, c] = rc(i);
    let v: number;
    if (isKing(cell)) {
      v = KING;
      // kings like the centre and the main diagonal
      v += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c));
    } else {
      const progress = color === 'w' ? 7 - r : r; // 0..7
      v = MAN + progress * 5;
      if (progress === 0) v += 12; // back-row guard
      if (c >= 2 && c <= 5 && progress >= 2 && progress <= 5) v += 3; // centre
    }
    score += color === me ? v : -v;
  }
  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return moves
    .map((m) => ({ m, k: m.captures.length * 10 + (m.promotes ? 8 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);
}

class Searcher {
  nodes = 0;
  aborted = false;
  constructor(private deadline: number) {}

  negamax(board: Cell[], color: Color, depth: number, alpha: number, beta: number, ply: number): number {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.aborted = true;
    if (this.aborted) return 0;
    const moves = legalMovesFor(board, color);
    if (moves.length === 0) return -WIN + ply;
    // extend forced captures so we do not stop in the middle of an exchange
    if (depth <= 0 && !(moves[0].captures.length > 0 && ply < 24)) return evaluate(board, color);
    let best = -Infinity;
    for (const m of orderMoves(moves)) {
      const next = applyToBoard(board, m);
      const v = -this.negamax(next, color === 'w' ? 'b' : 'w', depth - 1, -beta, -alpha, ply + 1);
      if (this.aborted) return 0;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function scoreRoot(board: Cell[], color: Color, moves: Move[], depth: number, s: Searcher): Array<{ m: Move; v: number }> | null {
  const out: Array<{ m: Move; v: number }> = [];
  let alpha = -Infinity;
  for (const m of orderMoves(moves)) {
    const v = -s.negamax(applyToBoard(board, m), color === 'w' ? 'b' : 'w', depth - 1, -Infinity, -alpha + 0, 1);
    if (s.aborted) return null;
    out.push({ m, v });
    if (v > alpha) alpha = v;
  }
  return out;
}

export function chooseMove(state: GameState, level: Difficulty, opts: BotOptions = {}): Move | null {
  const rnd = opts.random ?? Math.random;
  const color = state.turn;
  const moves = legalMovesFor(state.board, color);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  if (level === 'easy') {
    if (rnd() < 0.7) return moves[Math.floor(rnd() * moves.length)];
    const s = new Searcher(Infinity);
    const scored = scoreRoot(state.board, color, moves, 1, s)!;
    scored.sort((a, b) => b.v - a.v);
    return scored[0].m;
  }

  if (level === 'medium') {
    const s = new Searcher(Date.now() + (opts.timeMs ?? 600));
    const scored = scoreRoot(state.board, color, moves, 3, s);
    if (!scored) return moves[Math.floor(rnd() * moves.length)];
    const top = Math.max(...scored.map((x) => x.v));
    const near = scored.filter((x) => top - x.v <= 8);
    return near[Math.floor(rnd() * near.length)].m;
  }

  // hard: iterative deepening
  const deadline = Date.now() + (opts.timeMs ?? 700);
  let best: Move = orderMoves(moves)[0];
  for (let depth = 2; depth <= 12; depth++) {
    const s = new Searcher(deadline);
    const scored = scoreRoot(state.board, color, moves, depth, s);
    if (!scored) break; // out of time: keep the last completed depth
    scored.sort((a, b) => b.v - a.v);
    best = scored[0].m;
    if (scored[0].v > WIN / 2) break; // forced win found
    if (Date.now() > deadline) break;
  }
  return best;
}

/** Suggest a move for the human (used by the "hint" button). */
export function hintFor(state: GameState): Move | null {
  return chooseMove(state, 'hard', { timeMs: 350 });
}
