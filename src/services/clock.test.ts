import { describe, expect, test } from 'bun:test';
import { clockView, formatClock, type ClockState } from './clock.ts';

const base = (o: Partial<ClockState> = {}): ClockState => ({ timeControl: 60, whiteMs: 60_000, blackMs: 60_000, turnStartedAt: 1_000_000, moveCount: 0, ...o });

describe('game clock', () => {
  test("before White's first move: clocks frozen, only the 30 s move limit runs", () => {
    const v = clockView(base(), 1_000_000 + 12_000);
    expect(v.side).toBe('w');
    expect(v.running).toBe(false);
    expect(v.whiteMs).toBe(60_000);
    expect(v.moveLeftMs).toBe(18_000);
    expect(v.kind).toBe('move');
    expect(v.deadline).toBe(1_000_000 + 30_000);
  });
  test("after White's first move Black's clock runs, White's stays", () => {
    const v = clockView(base({ moveCount: 1 }), 1_000_000 + 7_000);
    expect(v.side).toBe('b');
    expect(v.blackMs).toBe(53_000);
    expect(v.whiteMs).toBe(60_000);
    expect(v.moveLeftMs).toBe(23_000);
  });
  test('after Black moves, White runs and Black is stopped', () => {
    const v = clockView(base({ moveCount: 2, blackMs: 53_000 }), 1_000_000 + 4_000);
    expect(v.side).toBe('w');
    expect(v.whiteMs).toBe(56_000);
    expect(v.blackMs).toBe(53_000);
  });
  test('below 30 s left, the clock (not the move limit) decides', () => {
    const v = clockView(base({ moveCount: 3, blackMs: 9_000 }), 1_000_000 + 2_000);
    expect(v.kind).toBe('clock');
    expect(v.moveLeftMs).toBe(7_000);
    expect(v.deadline).toBe(1_009_000);
  });
  test('never negative', () => {
    const v = clockView(base({ moveCount: 1, blackMs: 5_000 }), 1_000_000 + 90_000);
    expect(v.blackMs).toBe(0);
    expect(v.moveLeftMs).toBe(0);
  });
  test('formatting', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(9_400)).toBe('0:10');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});
