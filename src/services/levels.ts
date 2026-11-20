/**
 * DAMEO levels (from rating), every level is 100 points:
 *   Level 1: 0–1299 · Level 2: 1300–1399 · … · Level 11: 2200–2299 · … · Level 30: 4100–4199 · … · Level 100: 11100+
 * New players start at 1200 → Level 1. Rating up → level up; rating down → level down.
 */
export const MAX_LEVEL = 100;
export interface LevelInfo {
  level: number; // 1..MAX_LEVEL
  min: number; // first rating of this level
  next: number | null; // first rating of the next level (null at the top level)
  progress: number; // 0..1 within the level
}

export function levelOf(rating: number): LevelInfo {
  const level = rating < 1300 ? 1 : Math.min(MAX_LEVEL, Math.floor((rating - 1300) / 100) + 2);
  const min = level === 1 ? 0 : 1300 + (level - 2) * 100;
  const next = level === MAX_LEVEL ? null : level === 1 ? 1300 : min + 100;
  const span = level === 1 ? 1300 - 1000 : 100; // level 1 bar fills from 1000 so it is not always ~full
  const from = level === 1 ? 1000 : min;
  const progress = next === null ? 1 : Math.max(0, Math.min(1, (rating - from) / span));
  return { level, min, next, progress };
}

/**
 * Badge family (gets richer as the level climbs):
 *  1–3 blue · 4–6 violet · 7–9 pink · 10–14 gold · 15–19 emerald · 20–24 ruby · 25–29 diamond ·
 *  30–39 legend · 40–49 mythic · 50–59 celestial · 60–69 inferno · 70–79 aurora · 80–89 prism · 90–99 divine · 100 MAX
 */
export function levelTier(level: number): number {
  if (level >= MAX_LEVEL) return 15;
  if (level >= 30) return 8 + Math.floor((level - 30) / 10); // 30→8 … 90→14
  if (level >= 25) return 7;
  if (level >= 20) return 6;
  if (level >= 15) return 5;
  if (level >= 10) return 4;
  return Math.max(1, Math.ceil(level / 3));
}
