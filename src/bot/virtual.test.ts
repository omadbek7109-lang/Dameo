import { describe, expect, test } from 'bun:test';
import { commit, initialState, legalMoves } from '../engine/rules.ts';
import type { GameState } from '../engine/types.ts';
import { chooseMove } from './ai.ts';
import { effectiveLevel, planVirtualMove, thinkTime } from './virtual.ts';

// bun's test() takes a timeout as 3rd argument (the sandbox type shim does not know it)
const slowTest = test as unknown as (name: string, fn: () => void, timeoutMs: number) => void;
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('virtual opponents', () => {
  test('always a legal engine move', () => {
    let s: GameState = initialState();
    const rnd = seeded(7);
    for (let i = 0; i < 40 && s.result.status === 'playing'; i++) {
      const p = planVirtualMove({ state: s, level: 'normal', style: 'solid', timeControl: 180, botMs: 150_000, humanRating: 1200, random: rnd });
      expect(p).not.toBeNull();
      expect(legalMoves(s).some((m) => m.from === p!.move.from && m.path.join() === p!.move.path.join())).toBe(true);
      s = commit(s, p!.move);
    }
  });
  test('thinking time depends on the time control and is never a fixed number', () => {
    const rnd = seeded(3);
    const t = (tc: number) => Array.from({ length: 200 }, () => thinkTime({ timeControl: tc, style: 'solid', legal: 7, captures: false, botMs: tc * 1000, moveNo: 10 }, rnd));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const [a3, a5, a8] = [t(180), t(300), t(480)];
    expect(avg(a3)).toBeLessThan(avg(a5));
    expect(avg(a5)).toBeLessThan(avg(a8)); // 8-minute games: a calmer opponent
    expect(new Set(a3).size).toBeGreaterThan(150); // varied, not the same second every time
    expect(new Set(a8).size).toBeGreaterThan(150);
    for (const x of [...a3, ...a5, ...a8]) expect(x).toBeGreaterThanOrEqual(300);
    for (const x of [...a3, ...a5, ...a8]) expect(x).toBeLessThan(30_000); // always inside the 30 s move limit
  });
  test('forced moves come quickly; tempo follows the style', () => {
    const rnd = seeded(11);
    const forced = Array.from({ length: 50 }, () => thinkTime({ timeControl: 300, style: 'calm', legal: 1, captures: true, botMs: 300_000, moveNo: 20 }, rnd));
    expect(Math.max(...forced)).toBeLessThan(1700);
    const avg = (style: 'fast' | 'calm') =>
      Array.from({ length: 300 }, () => thinkTime({ timeControl: 180, style, legal: 6, captures: false, botMs: 180_000, moveNo: 12 }, rnd)).reduce((a, b) => a + b, 0) / 300;
    expect(avg('fast')).toBeLessThan(avg('calm'));
  });
  test('keeps to a share of its clock, but can occasionally overthink in 1-minute games', () => {
    const rnd = seeded(5);
    const xs = Array.from({ length: 2000 }, () => thinkTime({ timeControl: 60, style: 'calm', legal: 9, captures: true, botMs: 8_000, moveNo: 30 }, rnd));
    const normal = xs.filter((x) => x <= 8_000 * 0.12 + 1);
    expect(normal.length / xs.length).toBeGreaterThan(0.85);
    expect(xs.some((x) => x > 8_000)).toBe(true); // a flag is possible
  });
  test('strength adapts to the position (no scripted results)', () => {
    const rnd = seeded(9);
    const ahead = Array.from({ length: 400 }, () => effectiveLevel('normal', 'solid', 4, 1200, rnd));
    const behind = Array.from({ length: 400 }, () => effectiveLevel('normal', 'solid', -4, 1200, rnd));
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(ahead)).toBeLessThan(1);
    expect(mean(behind)).toBeGreaterThan(1);
    expect(effectiveLevel('pro', 'solid', 0, 1200, () => 0.99)).toBe(2);
    expect(effectiveLevel('beginner', 'solid', 0, 1200, () => 0.99)).toBe(0);
  });
  slowTest('balance: a normal opponent vs a medium-strength player ends up near 50/50 over many games', () => {
    const rnd = seeded(2024);
    let botWins = 0, humanWins = 0, draws = 0;
    for (let g = 0; g < 24; g++) {
      let s: GameState = initialState();
      for (let ply = 0; ply < 120 && s.result.status === 'playing'; ply++) {
        // "player" = the medium engine as white; virtual normal opponent as black
        const mv = s.turn === 'w' ? chooseMove(s, 'medium', { timeMs: 25, random: rnd }) : planVirtualMove({ state: s, level: 'normal', style: 'solid', timeControl: 60, botMs: 60_000, humanRating: 1200, random: rnd })?.move;
        if (!mv) break;
        s = commit(s, mv);
      }
      if (s.result.status === 'won') s.result.winner === 'b' ? botWins++ : humanWins++;
      else draws++;
    }
    const decided = botWins + humanWins;
    // not a scripted result: both sides win games, neither side dominates
    expect(botWins).toBeGreaterThan(0);
    expect(humanWins).toBeGreaterThan(0);
    if (decided >= 8) expect(botWins / decided).toBeLessThan(0.8);
    console.log(`balance sim: bot ${botWins} · player ${humanWins} · draw/long ${draws}`);
  }, 120_000);
});
