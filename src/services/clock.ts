/**
 * Game clock maths for player-vs-player games — mirrors the SQL rules in
 * supabase/migrations/0008_game_clocks.sql (the server is the judge; this only draws the clocks):
 *   - each player has 1 / 3 / 5 minutes;
 *   - White's first move does not use White's clock (it is only limited by the 30 s rule);
 *   - after that the side to move uses its own clock (chess clock);
 *   - every move must be made within 30 s, and within the player's remaining time.
 */
import type { Color } from '../engine/index.ts';

export const TIME_CONTROLS = [60, 180, 300] as const;
export type TimeControl = (typeof TIME_CONTROLS)[number];
export const DEFAULT_TIME_CONTROL: TimeControl = 180;
export const MOVE_LIMIT_MS = 30_000;
/** the server accepts a move up to this long after the deadline (network) */
export const GRACE_MS = 1_000;

export interface ClockState {
  timeControl: number;
  whiteMs: number;
  blackMs: number;
  /** when the side to move started thinking, in LOCAL clock ms (already corrected for server skew) */
  turnStartedAt: number;
  /** plies already played (even = White to move) */
  moveCount: number;
}

export interface ClockView {
  side: Color;
  /** remaining whole-game time for each side, as shown now */
  whiteMs: number;
  blackMs: number;
  /** time left for the current move (the smaller of the 30 s limit and the mover's clock) */
  moveLeftMs: number;
  /** the main clock of the side to move is running (false before White's first move) */
  running: boolean;
  /** local ms when the side to move runs out of time */
  deadline: number;
  kind: 'move' | 'clock';
}

export function clockView(c: ClockState, now: number): ClockView {
  const side: Color = c.moveCount % 2 === 0 ? 'w' : 'b';
  const sideMs = side === 'w' ? c.whiteMs : c.blackMs;
  const elapsed = Math.max(0, now - c.turnStartedAt);
  const running = c.moveCount > 0;
  const useClock = running && sideMs <= MOVE_LIMIT_MS;
  const limit = useClock ? Math.max(0, sideMs) : MOVE_LIMIT_MS;
  const shownSide = running ? Math.max(0, sideMs - elapsed) : sideMs;
  return {
    side,
    whiteMs: side === 'w' ? shownSide : c.whiteMs,
    blackMs: side === 'b' ? shownSide : c.blackMs,
    moveLeftMs: Math.max(0, limit - elapsed),
    running,
    deadline: c.turnStartedAt + limit,
    kind: useClock ? 'clock' : 'move',
  };
}

/** m:ss (rounded up, so 0:00 really means the time is gone) */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const isTimeControl = (n: unknown): n is TimeControl => TIME_CONTROLS.includes(n as TimeControl);
