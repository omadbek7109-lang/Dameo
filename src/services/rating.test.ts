import { describe, expect, test } from 'bun:test';
import { expectedScore, kFactor, ratingDelta, RATING_FLOOR } from './rating.ts';

describe('rating', () => {
  test('equal ratings: win gives +K/2', () => {
    expect(ratingDelta(1200, 1200, 1, 50)).toBe(12);
    expect(ratingDelta(1200, 1200, 0, 50)).toBe(-12);
    expect(ratingDelta(1200, 1200, 0.5, 50)).toBe(0);
  });
  test('provisional players move faster', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(19)).toBe(40);
    expect(kFactor(20)).toBe(24);
    expect(ratingDelta(1200, 1200, 1, 0)).toBe(20);
  });
  test('beating a stronger player is worth more', () => {
    expect(ratingDelta(1200, 1500, 1, 50)).toBeGreaterThan(ratingDelta(1200, 1200, 1, 50));
  });
  test('draw against a stronger player is positive, against weaker is negative', () => {
    expect(ratingDelta(1200, 1500, 0.5, 50)).toBeGreaterThan(0);
    expect(ratingDelta(1500, 1200, 0.5, 50)).toBeLessThan(0);
  });
  test('expected scores sum to 1', () => {
    expect(expectedScore(1300, 1100) + expectedScore(1100, 1300)).toBeCloseTo(1, 10);
  });
  test('never drops below the floor', () => {
    expect(1 + ratingDelta(RATING_FLOOR, 2000, 0, 50) + RATING_FLOOR - 1).toBe(RATING_FLOOR);
  });
});
