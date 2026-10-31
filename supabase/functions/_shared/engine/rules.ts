/**
 * RULESET: Russian draughts (shashki), the variant played across Uzbekistan
 * and the wider region. One consistent ruleset — no mixing of variants.
 *
 *  1. 8×8 board, pieces on dark squares only. White moves first.
 *  2. Men move one square diagonally FORWARD.
 *  3. Men capture forward AND backward by jumping an adjacent enemy.
 *  4. Kings ("flying kings") move any distance diagonally and capture from a
 *     distance, landing on any empty square beyond the captured piece.
 *  5. Capturing is MANDATORY. You may choose any capture sequence (there is
 *     no "majority" rule) but must finish the sequence you start.
 *  6. A captured piece is removed only after the whole move ends, and it can
 *     not be jumped twice ("Turkish strike" rule).
 *  7. A man reaching the far row in the middle of a capture continues
 *     capturing as a king in the same move.
 *  8. A player with no legal move (no pieces, or all blocked) loses.
 *  9. Draws: threefold repetition, or 30 consecutive plies (15 moves each)
 *     with only kings on the board and no captures.
 */
import type { Cell, Color, GameState, Move, MoveRecord } from './types.ts';

export const SIZE = 8;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const isDark = (r: number, c: number) => (r + c) % 2 === 1;
export const rc = (i: number): [number, number] => [(i / SIZE) | 0, i % SIZE];
export const idx = (r: number, c: number) => r * SIZE + c;
const inside = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export const colorOf = (cell: Cell): Color | null => (cell > 0 ? 'w' : cell < 0 ? 'b' : null);
export const isKing = (cell: Cell) => cell === 2 || cell === -2;
const opponent = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const forward = (c: Color) => (c === 'w' ? -1 : 1);
const promotionRow = (c: Color) => (c === 'w' ? 0 : SIZE - 1);

export function initialBoard(): Cell[] {
  const b: Cell[] = new Array(64).fill(0);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isDark(r, c)) continue;
      if (r < 3) b[idx(r, c)] = -1;
      else if (r > 4) b[idx(r, c)] = 1;
    }
  }
  return b;
}

export function positionKey(board: Cell[], turn: Color): string {
  let s = turn;
  for (const c of board) s += c === 0 ? '.' : c === 1 ? 'w' : c === 2 ? 'W' : c === -1 ? 'b' : 'B';
  return s;
}

export function initialState(): GameState {
  const board = initialBoard();
  return {
    board,
    turn: 'w',
    history: [],
    result: { status: 'playing' },
    quietPlies: 0,
    seen: { [positionKey(board, 'w')]: 1 },
  };
}

/* ------------------------------------------------------------------ */
/* Move generation                                                     */
/* ------------------------------------------------------------------ */

interface CaptureCtx {
  board: Cell[];
  color: Color;
  origin: number;
}

/** Recursive capture search. `captured` pieces stay on the board (they block). */
function searchCaptures(
  ctx: CaptureCtx,
  pos: number,
  king: boolean,
  captured: number[],
  path: number[],
  promoted: boolean,
  out: Move[],
): boolean {
  const { board, color, origin } = ctx;
  const [r0, c0] = rc(pos);
  let foundAny = false;

  const isEmpty = (i: number) => board[i] === 0 || i === origin;

  for (const [dr, dc] of DIRS) {
    if (king) {
      // fly along the diagonal to the first non-empty square
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && isEmpty(idx(r, c))) {
        r += dr;
        c += dc;
      }
      if (!inside(r, c)) continue;
      const victim = idx(r, c);
      if (colorOf(board[victim]) !== opponent(color) || captured.includes(victim)) continue;
      // landing squares: all empties directly beyond
      const landings: number[] = [];
      let lr = r + dr;
      let lc = c + dc;
      while (inside(lr, lc) && isEmpty(idx(lr, lc))) {
        landings.push(idx(lr, lc));
        lr += dr;
        lc += dc;
      }
      if (landings.length === 0) continue;
      foundAny = true;
      const nextCaptured = [...captured, victim];
      // Landings from which the chain can continue are mandatory if any exist.
      const continuing: number[] = [];
      for (const land of landings) {
        const canContinue = searchCaptures(ctx, land, true, nextCaptured, [...path, land], promoted, []);
        if (canContinue) continuing.push(land);
      }
      const chosen = continuing.length > 0 ? continuing : landings;
      for (const land of chosen) {
        searchCaptures(ctx, land, true, nextCaptured, [...path, land], promoted, out);
      }
    } else {
      const r1 = r0 + dr;
      const c1 = c0 + dc;
      const r2 = r0 + 2 * dr;
      const c2 = c0 + 2 * dc;
      if (!inside(r2, c2)) continue;
      const victim = idx(r1, c1);
      const land = idx(r2, c2);
      if (colorOf(board[victim]) !== opponent(color) || captured.includes(victim)) continue;
      if (!isEmpty(land)) continue;
      foundAny = true;
      const nextCaptured = [...captured, victim];
      const becomesKing = r2 === promotionRow(color);
      // a man that reaches the last row continues as a king (rule 7)
      searchCaptures(ctx, land, becomesKing, nextCaptured, [...path, land], promoted || becomesKing, out);
    }
  }

  if (!foundAny && captured.length > 0) {
    out.push({ from: origin, to: pos, path, captures: captured, promotes: promoted });
  }
  return foundAny;
}

function capturesFor(board: Cell[], pos: number): Move[] {
  const cell = board[pos];
  const color = colorOf(cell);
  if (!color) return [];
  const out: Move[] = [];
  searchCaptures({ board, color, origin: pos }, pos, isKing(cell), [], [], false, out);
  return out;
}

function quietFor(board: Cell[], pos: number): Move[] {
  const cell = board[pos];
  const color = colorOf(cell);
  if (!color) return [];
  const [r0, c0] = rc(pos);
  const out: Move[] = [];
  if (isKing(cell)) {
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[idx(r, c)] === 0) {
        out.push({ from: pos, to: idx(r, c), path: [idx(r, c)], captures: [], promotes: false });
        r += dr;
        c += dc;
      }
    }
  } else {
    const dr = forward(color);
    for (const dc of [-1, 1]) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (inside(r, c) && board[idx(r, c)] === 0) {
        out.push({
          from: pos,
          to: idx(r, c),
          path: [idx(r, c)],
          captures: [],
          promotes: r === promotionRow(color),
        });
      }
    }
  }
  return out;
}

/** All legal moves for `color`. If any capture exists, only captures are returned. */
export function legalMovesFor(board: Cell[], color: Color): Move[] {
  const captures: Move[] = [];
  for (let i = 0; i < 64; i++) {
    if (colorOf(board[i]) === color) captures.push(...capturesFor(board, i));
  }
  if (captures.length > 0) return captures;
  const quiet: Move[] = [];
  for (let i = 0; i < 64; i++) {
    if (colorOf(board[i]) === color) quiet.push(...quietFor(board, i));
  }
  return quiet;
}

export function legalMoves(state: GameState): Move[] {
  if (state.result.status !== 'playing') return [];
  return legalMovesFor(state.board, state.turn);
}

/* ------------------------------------------------------------------ */
/* Applying moves                                                      */
/* ------------------------------------------------------------------ */

/** Apply a move to a raw board (no validation). Returns a new board. */
export function applyToBoard(board: Cell[], move: Move): Cell[] {
  const next = board.slice();
  const piece = next[move.from];
  next[move.from] = 0;
  for (const c of move.captures) next[c] = 0;
  const color = colorOf(piece)!;
  const reachedEnd = rc(move.to)[0] === promotionRow(color);
  const king = isKing(piece) || move.promotes || (reachedEnd && !isKing(piece));
  next[move.to] = (king ? 2 : 1) * (color === 'w' ? 1 : -1) as Cell;
  return next;
}

export const squareName = (i: number) => {
  const [r, c] = rc(i);
  return 'abcdefgh'[c] + (8 - r);
};

function notate(m: Move): string {
  const sep = m.captures.length > 0 ? ':' : '-';
  return [m.from, ...m.path].map(squareName).join(sep);
}

const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.path.length === b.path.length && a.path.every((p, i) => p === b.path[i]);

export type MoveError = 'game-over' | 'empty-square' | 'not-your-piece' | 'illegal' | 'must-capture';

export interface MoveOutcome {
  ok: boolean;
  error?: MoveError;
  state: GameState;
  move?: Move;
}

/** Validate and apply a move given as origin + landing path. Never mutates. */
export function playMove(state: GameState, from: number, path: number[]): MoveOutcome {
  if (state.result.status !== 'playing') return { ok: false, error: 'game-over', state };
  const cell = state.board[from];
  if (cell === 0) return { ok: false, error: 'empty-square', state };
  if (colorOf(cell) !== state.turn) return { ok: false, error: 'not-your-piece', state };
  const legal = legalMoves(state);
  const wanted: Move = { from, to: path[path.length - 1], path, captures: [], promotes: false };
  const found = legal.find((m) => sameMove(m, wanted));
  if (!found) {
    const mustCapture = legal.some((m) => m.captures.length > 0);
    return { ok: false, error: mustCapture ? 'must-capture' : 'illegal', state };
  }
  return { ok: true, state: commit(state, found), move: found };
}

/** Apply an already-validated move and compute the new game result. */
export function commit(state: GameState, move: Move): GameState {
  const mover = state.turn;
  const piece = state.board[move.from];
  const board = applyToBoard(state.board, move);
  const turn = opponent(mover);
  const wasMan = !isKing(piece);
  const quiet = move.captures.length > 0 || wasMan ? 0 : state.quietPlies + 1;
  const key = positionKey(board, turn);
  const seen = { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 };
  const record: MoveRecord = {
    color: mover,
    from: move.from,
    path: move.path,
    captures: move.captures,
    promotes: move.promotes || (wasMan && rc(move.to)[0] === promotionRow(mover)),
    notation: notate(move),
  };
  const next: GameState = {
    board,
    turn,
    history: [...state.history, record],
    result: { status: 'playing' },
    quietPlies: quiet,
    seen,
  };
  next.result = evaluate(next);
  return next;
}

function evaluate(s: GameState): GameState['result'] {
  if (legalMovesFor(s.board, s.turn).length === 0) {
    return { status: 'won', winner: s.turn === 'w' ? 'b' : 'w', reason: 'no-moves' };
  }
  if ((s.seen[positionKey(s.board, s.turn)] ?? 0) >= 3) return { status: 'draw', reason: 'repetition' };
  const onlyKings = s.board.every((c) => c === 0 || isKing(c));
  if (onlyKings && s.quietPlies >= 30) return { status: 'draw', reason: 'kings-only' };
  return { status: 'playing' };
}

export function resign(state: GameState, loser: Color): GameState {
  if (state.result.status !== 'playing') return state;
  return { ...state, result: { status: 'won', winner: opponent(loser), reason: 'resign' } };
}

export function agreeDraw(state: GameState): GameState {
  if (state.result.status !== 'playing') return state;
  return { ...state, result: { status: 'draw', reason: 'agreement' } };
}

export function countPieces(board: Cell[]) {
  const n = { w: 0, b: 0, wKings: 0, bKings: 0 };
  for (const c of board) {
    if (c > 0) {
      n.w++;
      if (c === 2) n.wKings++;
    } else if (c < 0) {
      n.b++;
      if (c === -2) n.bKings++;
    }
  }
  return n;
}

/** Replay a list of {from,path} moves from the start. Used by the server to validate matches. */
export function replay(moves: Array<{ from: number; path: number[] }>): { ok: boolean; state: GameState; badPly?: number } {
  let s = initialState();
  for (let i = 0; i < moves.length; i++) {
    const out = playMove(s, moves[i].from, moves[i].path);
    if (!out.ok) return { ok: false, state: s, badPly: i };
    s = out.state;
  }
  return { ok: true, state: s };
}
