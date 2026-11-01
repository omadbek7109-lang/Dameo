/**
 * DAMEO levels (from rating):
 *   Level 1: 0–1299 · Level 2: 1300–1399 · … · Level 9: 2000–2099 · Level 10: 2100+
 * New players start at 1200 → Level 1. Rating up → level up; rating down → level down.
 */
export interface LevelInfo {
  level: number; // 1..10
  min: number; // first rating of this level
  next: number | null; // first rating of the next level (null at level 10)
  progress: number; // 0..1 within the level
}

export function levelOf(rating: number): LevelInfo {
  const level = rating < 1300 ? 1 : Math.min(10, Math.floor((rating - 1300) / 100) + 2);
  const min = level === 1 ? 0 : 1300 + (level - 2) * 100;
  const next = level === 10 ? null : level === 1 ? 1300 : min + 100;
  const span = level === 1 ? 1300 - 1000 : 100; // level 1 bar fills from 1000 so it is not always ~full
  const from = level === 1 ? 1000 : min;
  const progress = next === null ? 1 : Math.max(0, Math.min(1, (rating - from) / span));
  return { level, min, next, progress };
}
