/**
 * DAMEO game engine — shared types.
 *
 * Board coordinates: square index = row * 8 + col, row 0 is the TOP of the
 * screen. White starts on rows 5–7 and moves "up" (towards row 0).
 * Playable squares are the dark ones: (row + col) is odd.
 */
export type Color = 'w' | 'b';

/** 0 empty, 1 white man, 2 white king, -1 black man, -2 black king */
export type Cell = 0 | 1 | 2 | -1 | -2;

export interface Move {
  from: number;
  to: number;
  /** every landing square, in order. Last element === to. */
  path: number[];
  /** squares of captured enemy pieces, in capture order */
  captures: number[];
  /** true if a man became a king during this move */
  promotes: boolean;
}

export type GameResult =
  | { status: 'playing' }
  | { status: 'won'; winner: Color; reason: 'no-moves' | 'resign' }
  | { status: 'draw'; reason: 'repetition' | 'kings-only' | 'agreement' };

export interface MoveRecord {
  color: Color;
  from: number;
  path: number[];
  captures: number[];
  promotes: boolean;
  notation: string;
}

export interface GameState {
  board: Cell[];
  turn: Color;
  history: MoveRecord[];
  result: GameResult;
  /** plies since the last capture or man move (used for the kings-only draw) */
  quietPlies: number;
  /** position key -> number of occurrences (for threefold repetition) */
  seen: Record<string, number>;
}
