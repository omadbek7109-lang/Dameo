import { describe, expect, test } from 'bun:test';
import { formatTashkent, formatWeekRange, splitDuration } from './weekly.ts';

// Monday 2 Nov 2026 00:00 in Tashkent (UTC+5) = Sunday 1 Nov 19:00 UTC
const START = Date.UTC(2026, 10, 1, 19, 0, 0);
const END = START + 7 * 86400_000;

describe('weekly tournament time helpers (Asia/Tashkent)', () => {
  test('week boundaries are shown in Tashkent time on any device', () => {
    expect(formatTashkent(START, 'uz')).toBe('Dushanba, 2-noyabr, 00:00');
    expect(formatTashkent(END, 'uz')).toBe('Dushanba, 9-noyabr, 00:00');
    expect(formatTashkent(END - 60_000, 'uz')).toBe('Yakshanba, 8-noyabr, 23:59');
  });
  test('week range', () => {
    expect(formatWeekRange(START, END, 'uz')).toBe('2–8 noyabr');
    expect(formatWeekRange(Date.UTC(2026, 10, 29, 19), Date.UTC(2026, 11, 6, 19), 'uz')).toBe('30 noyabr – 6 dekabr');
  });
  test('countdown split', () => {
    expect(splitDuration(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000)).toEqual({ d: 2, h: 3, m: 4, s: 5 });
    expect(splitDuration(-10)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });
});
