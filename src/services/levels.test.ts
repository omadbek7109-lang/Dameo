import { describe, expect, test } from 'bun:test';
import { levelOf, levelTier } from './levels.ts';

describe('levels', () => {
  test('table boundaries', () => {
    const cases: Array<[number, number]> = [
      [0, 1], [1200, 1], [1299, 1], [1300, 2], [1399, 2], [1400, 3], [1499, 3], [1500, 4], [1600, 5],
      [1700, 6], [1800, 7], [1899, 7], [1900, 8], [1999, 8], [2000, 9], [2099, 9], [2100, 10], [2199, 10], [2200, 11], [2299, 11], [2900, 18], [3000, 19], [3999, 28], [4000, 29], [4099, 29], [4100, 30], [9000, 30],
    ];
    for (const [r, l] of cases) expect(levelOf(r).level).toBe(l);
  });
  test('new player (1200) is Level 1 with 100 points to Level 2', () => {
    const l = levelOf(1200);
    expect(l.level).toBe(1);
    expect(l.next! - 1200).toBe(100);
  });
  test('level 10 → 11 at 2200; level 30 (4100+) is the top', () => {
    expect(levelOf(2150).next).toBe(2200);
    expect(levelOf(4100).next).toBeNull();
    expect(levelOf(4099).next).toBe(4100);
  });
  test('badge tiers', () => {
    const cases: Array<[number, number]> = [[1, 1], [3, 1], [4, 2], [6, 2], [7, 3], [9, 3], [10, 4], [14, 4], [15, 5], [20, 6], [25, 7], [29, 7], [30, 8]];
    for (const [l, t] of cases) expect(levelTier(l)).toBe(t);
  });
});
