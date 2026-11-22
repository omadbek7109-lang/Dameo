import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PRICE,
  boostPct,
  DEFAULT_REWARDS,
  DEFAULT_RULES,
  LEVEL_XP,
  MAX_LEVEL,
  SEASON_DAYS,
  buildPass,
  checkPassClaim,
  dayStartUtc,
  levelOf,
  rewardCoins,
  priceDiscount,
  seasonAt,
  seasonXp,
  tashkentDay,
  trackCoins,
  type PassGame,
  type SeasonActivity,
} from './core.ts';

const empty = (): SeasonActivity => ({ games: [], checkins: [], missions: {}, missionBonus: [], referrals: [] });
const T0 = dayStartUtc('2026-11-23') + 10 * 3600_000; // a Monday, 10:00 Tashkent
const game = (o: Partial<PassGame> = {}): PassGame => ({ ts: T0, live: true, outcome: 'win', moves: 30, vsBot: false, ...o });

describe('seasons', () => {
  test('every season lasts 21 days, Tashkent midnight', () => {
    const s1 = seasonAt(dayStartUtc('2026-11-22'));
    expect(s1.n).toBe(1);
    expect(tashkentDay(s1.start)).toBe('2026-11-22');
    expect(tashkentDay(s1.end - 1)).toBe('2026-12-12');
    expect(seasonAt(dayStartUtc('2026-11-20')).n).toBe(1); // before the start: Season 1 (not started yet)
    const s2 = seasonAt(dayStartUtc('2026-12-13'));
    expect(s2.n).toBe(2);
    expect(seasonAt(dayStartUtc('2026-12-13') - 1).n).toBe(1);
    expect(s2.end - s2.start).toBe(SEASON_DAYS * 86_400_000);
    expect(seasonAt(s2.end).n).toBe(3);
    expect(s2.theme.name_uz).not.toBe(s1.theme.name_uz);
  });
  test('Premium: 50 Stars, 10% off 55', () => {
    expect(DEFAULT_PRICE.stars).toBe(50);
    expect(priceDiscount(DEFAULT_PRICE)).toBe(10);
  });
});

describe('levels', () => {
  test('fast start, slow end: 100 / 250 / 450 / 800, total 7 900', () => {
    expect(levelOf(0).level).toBe(1);
    expect(LEVEL_XP[5]).toBe(400);
    expect(LEVEL_XP[10]).toBe(1650);
    expect(LEVEL_XP[15]).toBe(3900);
    expect(LEVEL_XP[MAX_LEVEL]).toBe(7900);
    expect(levelOf(LEVEL_XP[2] - 1).level).toBe(1);
    expect(levelOf(LEVEL_XP[2]).level).toBe(2);
    expect(levelOf(99_999)).toEqual({ level: 20, into: 0, step: 0, nextAt: null });
    expect(levelOf(110)).toEqual({ level: 2, into: 10, step: 100, nextAt: 200 });
  });
});

describe('xp', () => {
  const season = seasonAt(T0);
  test('every game gives XP: live 15 (+25 win), bot 5 (+10 win), first win of the day +50, short games ignored', () => {
    const a = empty();
    a.games = [game(), game({ outcome: 'loss', ts: T0 + 1, opp: 'b' }), game({ moves: 5, ts: T0 + 2 })];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(15 + 25 + 50 + 15);
    const b = empty();
    b.games = [game({ live: false, vsBot: true, outcome: 'loss' }), game({ live: false, vsBot: true, ts: T0 + 1 })];
    expect(seasonXp(b, season, DEFAULT_RULES, false, T0).total).toBe(5 + 5 + 10 + 50);
  });
  test('per-day limits: 20 live games, 3 vs the same opponent, 15 bot games, 10 bot wins', () => {
    const a = empty();
    a.games = Array.from({ length: 30 }, (_, i) => game({ ts: T0 + i, outcome: 'loss', opp: `p${i}` }));
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(20 * 15);
    a.games = Array.from({ length: 10 }, (_, i) => game({ ts: T0 + i, outcome: 'loss', opp: 'friend' }));
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(3 * 15);
    a.games = Array.from({ length: 20 }, (_, i) => game({ ts: T0 + i, live: false, vsBot: true }));
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(15 * 5 + 10 * 10 + 50);
  });
  test('7 check-ins in a row give +100 (again at 14)', () => {
    const a = empty();
    a.checkins = Array.from({ length: 8 }, (_, i) => tashkentDay(T0 + i * 86_400_000));
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0 + 8 * 86_400_000).total).toBe(8 * 25 + 100);
    a.checkins = [tashkentDay(T0), ...Array.from({ length: 6 }, (_, i) => tashkentDay(T0 + (i + 2) * 86_400_000))]; // a gap
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0 + 8 * 86_400_000).total).toBe(7 * 25);
  });
  test('no daily XP limit; boosters multiply the day', () => {
    const a = empty();
    a.games = Array.from({ length: 10 }, (_, i) => game({ ts: T0 + i, opp: `p${i}` })); // 400 + 50
    a.checkins = [tashkentDay(T0)]; // 25
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(475);
    const b20 = [{ pct: 20, from: T0, until: T0 + 86_400_000 }];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0, b20).total).toBe(570);
    a.missions = { [tashkentDay(T0)]: 7 }; // +140
    const r = seasonXp(a, season, DEFAULT_RULES, false, T0, b20);
    expect(r.total).toBe(Math.floor(615 * 1.2));
    expect(r.capped).toBe(false);
  });
  test('a 5-hour booster counts only for what happens inside those 5 hours', () => {
    const a = empty();
    const H = 3_600_000;
    a.games = [game({ ts: T0 + H, outcome: 'loss' }), game({ ts: T0 + 6 * H, outcome: 'loss', opp: 'x' })]; // 15 + 15
    a.checkins = [tashkentDay(T0)]; // 25, no time → no short boost
    const b30 = [{ pct: 30, from: T0, until: T0 + 5 * H }];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0, b30).total).toBe(15 + 4 + 15 + 25);
  });
  test('invited friends: 100 XP each, at most 2 a day; other seasons ignored', () => {
    const a = empty();
    a.referrals = [T0, T0 + 1, T0 + 2, T0 + 3, T0 + 86_400_000, season.end + 1000]; // 4 on day 1, 1 on day 2, 1 next season
    a.games = [game({ ts: season.end + 1000 })];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(3 * 100);
  });
  test('first 20 live games a day give XP win or lose; after them every win counts, losses do not; new day starts over', () => {
    const a = empty();
    // 30 games on one day: 20 losses, then 5 wins and 5 losses
    a.games = Array.from({ length: 30 }, (_, i) => game({ ts: T0 + i, opp: `p${i}`, outcome: i < 20 || i % 2 === 0 ? 'loss' : 'win' }));
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(20 * 15 + 5 * 25 + 50);
    // the same next day: counted again
    a.games = [...a.games, ...a.games.map((g) => ({ ...g, ts: g.ts + 86_400_000 }))];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0).total).toBe(2 * (20 * 15 + 5 * 25 + 50));
  });
});

describe('rewards and claims', () => {
  test('40 different rewards, each with its own picture', () => {
    expect(new Set(DEFAULT_REWARDS.map((r) => `${r.kind}:${r.value}`)).size).toBe(40);
  });
  test('every level has one free and one elite reward', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(DEFAULT_REWARDS.filter((r) => r.level === l && r.track === 'free').length).toBe(1);
      expect(DEFAULT_REWARDS.filter((r) => r.level === l && r.track === 'elite').length).toBe(1);
    }
  });
  test('coin budget per season stays modest (cosmetics are the value)', () => {
    expect(trackCoins(DEFAULT_REWARDS, 'free')).toBeLessThanOrEqual(1300); // 750 + chests
    expect(trackCoins(DEFAULT_REWARDS, 'elite')).toBe(2500); // 300 + 500 + 700 + 1000; the chests give cosmetics
  });
  test('box rolls stay inside the range', () => {
    const box = DEFAULT_REWARDS.find((r) => r.kind === 'box')!;
    expect(rewardCoins(box, false, 0)).toBe(box.min!);
    expect(rewardCoins(box, false, 0.9999999)).toBe(box.max!);
    for (let i = 0; i < 50; i++) {
      const v = rewardCoins(box, false, Math.random());
      expect(v >= box.min! && v <= box.max!).toBe(true);
    }
  });
  test('xp boosters: strongest one that touches the day, no stacking', () => {
    const a = empty();
    a.games = [game()];
    const season = seasonAt(T0);
    const boosts = [
      { pct: 10, from: T0 - 1000, until: T0 + 3 * 86_400_000 },
      { pct: 50, from: T0 - 1000, until: T0 + 1000 },
    ];
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0, boosts).total).toBe(135); // 90 × 1.1 + the 5-hour one's extra 40% on each event (6 + 10 + 20);
    expect(seasonXp(a, season, DEFAULT_RULES, false, T0, [boosts[0]]).total).toBe(99);
    expect(boostPct(boosts, tashkentDay(T0 + 5 * 86_400_000))).toBe(0);
  });
  test('claim rules: locked / elite / ready / already', () => {
    const a = empty();
    const b = buildPass(seasonAt(T0), a, DEFAULT_RULES, DEFAULT_REWARDS, [], false, DEFAULT_PRICE, T0);
    expect(b.level.level).toBe(1);
    expect(checkPassClaim(b, 1, 'free').ok).toBe(true);
    expect(checkPassClaim(b, 1, 'elite')).toEqual({ ok: false, error: 'elite' });
    expect(checkPassClaim(b, 2, 'free')).toEqual({ ok: false, error: 'locked' });
    expect(checkPassClaim(b, 99, 'free')).toEqual({ ok: false, error: 'unknown' });
    const b2 = buildPass(seasonAt(T0), a, DEFAULT_RULES, DEFAULT_REWARDS, ['free:1'], true, DEFAULT_PRICE, T0);
    expect(checkPassClaim(b2, 1, 'free')).toEqual({ ok: false, error: 'already' });
    expect(checkPassClaim(b2, 1, 'elite').ok).toBe(true);
    expect(b2.readyCount).toBe(1);
  });
  test('owned item turns into coins', () => {
    const item = DEFAULT_REWARDS.find((r) => r.kind === 'item')!;
    expect(rewardCoins(item, false)).toBe(0);
    expect(rewardCoins(item, true)).toBe(item.fallbackCoins);
  });
  test('pace: a casual player sees Lv.10 in about 6 days, an active one ends in about 12', () => {
    const casual = 5 * 15 + 2 * 25 + 50 + 25 + 3 * 20; // 5 games, 2 wins, first win, check-in, 3 missions = 260
    const active = 15 * 15 + 7 * 25 + 50 + 25 + 7 * 20 + 40; // 655
    expect(Math.ceil(LEVEL_XP[10] / casual)).toBe(7);
    expect(Math.ceil(LEVEL_XP[MAX_LEVEL] / active)).toBe(13);
    expect(levelOf(casual * 21).level).toBeGreaterThanOrEqual(15);
  });
});
