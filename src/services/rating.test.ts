import { describe, expect, test } from 'bun:test';
import { RATING_FLOOR, ratingDelta } from './rating.ts';

describe('rating (±5)', () => {
  test('win +5, loss -5, draw 0 regardless of ratings', () => {
    expect(ratingDelta(1200, 1200, 1)).toBe(5);
    expect(ratingDelta(1200, 2000, 0)).toBe(-5);
    expect(ratingDelta(1500, 900, 0.5)).toBe(0);
  });
  test('never drops below the floor', () => {
    expect(ratingDelta(RATING_FLOOR, 1200, 0)).toBe(0);
    expect(ratingDelta(RATING_FLOOR + 3, 1200, 0)).toBe(-3);
  });
});
