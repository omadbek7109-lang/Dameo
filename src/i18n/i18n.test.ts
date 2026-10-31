import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en.ts';
import { uz } from './uz.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(f) && !f.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('i18n', () => {
  test('uz and en define exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(uz).sort());
  });
  test('no empty strings', () => {
    for (const [k, v] of Object.entries({ ...uz })) expect(v.length > 0 || k).toBeTruthy();
    for (const [k, v] of Object.entries(en)) expect(v.length > 0 || k).toBeTruthy();
  });
  test('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(uz) as Array<keyof typeof uz>) expect(ph(en[k])).toBe(ph(uz[k]));
  });
  test('every literal t(...) key used in source exists in the dictionary', () => {
    const missing: string[] = [];
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) if (!(m[1] in uz)) missing.push(`${file}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
  test('dynamic key families are complete', () => {
    const fams: Array<[string, string[]]> = [
      ['ach.', ['firstWin', 'tenGames', 'streak3', 'rating1400', 'beatHard', 'firstDraw', 'veteran']],
      ['bot.', ['easy', 'medium', 'hard']],
      ['level.', ['beginner', 'amateur', 'advanced', 'expert', 'master']],
      ['result.', ['win', 'loss', 'draw']],
      ['tour.format.', ['single_elimination', 'swiss', 'round_robin']],
    ];
    for (const [p, ids] of fams) for (const id of ids) expect(`${p}${id}` in uz).toBe(true);
  });
});
