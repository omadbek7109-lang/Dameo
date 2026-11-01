import { describe, expect, test } from 'bun:test';
import { levelOf } from './levels.ts';

describe('levels', () => {
  test('table boundaries', () => {
    const cases: Array<[number, number]> = [
      [0, 1], [1200, 1], [1299, 1], [1300, 2], [1399, 2], [1400, 3], [1499, 3], [1500, 4], [1600, 5],
      [1700, 6], [1800, 7], [1899, 7], [1900, 8], [1999, 8], [2000, 9], [2099, 9], [2100, 10], [2900, 10],
    ];
    for (const [r, l] of cases) expect(levelOf(r).level).toBe(l);
  });
  test('new player (1200) is Level 1 with 100 points to Level 2', () => {
    const l = levelOf(1200);
    expect(l.level).toBe(1);
    expect(l.next! - 1200).toBe(100);
  });
  test('level 10 has no next level', () => {
    expect(levelOf(2150).next).toBeNull();
  });
});
