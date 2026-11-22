/**
 * DAMEO Pass (season pass, "Royale Pass" style): pure rules shared by the beta (demo) adapter and mirrored 1:1 in SQL
 * (supabase/migrations/0031_season_pass.sql). No React, no I/O — unit-tested in core.test.ts.
 *
 *  - Every season lasts 21 days (00:00 Tashkent) and has 20 levels; SEASONS holds the first season's start.
 *  - XP comes from playing, winning, daily check-in, daily missions and invited friends; daily / per-season caps
 *    stop farming. XP is derived by the server from its own rows — the client never reports XP.
 *  - Two reward tracks per level: Free (everyone) and Elite (bought once per season, for coins or Stars).
 *    Every reward is claimed by pressing "Olish" (never automatic), once per season, level and track.
 */

/* ------------------------------------------------------------------ Uzbekistan time (UTC+5, no DST) */
export const TZ_OFFSET_MS = 5 * 3600 * 1000;
export const DAY_MS = 86_400_000;
export const tashkentDay = (ts: number): string => new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);
export const dayStartUtc = (day: string): number => Date.parse(`${day}T00:00:00Z`) - TZ_OFFSET_MS;

/* ------------------------------------------------------------------ seasons */
/** Length of every season after the ones listed in SEASONS. */
export const SEASON_DAYS = 21;

export interface SeasonTheme {
  name_uz: string;
  name_en: string;
  /** colour accent of the season (CSS) */
  hue: number;
}
/** Themes rotate; the season number picks one. */
export const THEMES: SeasonTheme[] = [
  { name_uz: 'Royal Legacy', name_en: 'Royal Legacy', hue: 275 },
  { name_uz: "Muz qal'a", name_en: 'Ice Fortress', hue: 190 },
  { name_uz: 'Oltin toj', name_en: 'Golden Crown', hue: 42 },
  { name_uz: 'Tungi arena', name_en: 'Night Arena', hue: 265 },
  { name_uz: 'Bahor shamoli', name_en: 'Spring Wind', hue: 140 },
  { name_uz: 'Olov jangi', name_en: 'Battle of Fire', hue: 12 },
];

/** Seasons with their own dates (Tashkent day of the start, length in days). Change only together with the server table. */
export interface SeasonDef {
  start: string;
  days: number;
  theme: SeasonTheme;
}
export const SEASONS: SeasonDef[] = [
  // Season 01 "Royal Legacy" (beta starts it on 22 Nov; the main app puts its own start date here at launch)
  { start: '2026-11-22', days: 21, theme: THEMES[0] },
];

export interface Season {
  n: number;
  start: number; // UTC ms, inclusive
  end: number; // UTC ms, exclusive
  theme: SeasonTheme;
}
export function seasonAt(ts: number, list: SeasonDef[] = SEASONS): Season {
  const at = (i: number) => dayStartUtc(list[i].start);
  // before the first season: Season 1 (it has not started yet)
  if (ts < at(0)) return { n: 1, start: at(0), end: at(0) + list[0].days * DAY_MS, theme: list[0].theme };
  for (let i = 0; i < list.length; i++) {
    const end = at(i) + list[i].days * DAY_MS;
    if (ts < end) return { n: i + 1, start: at(i), end, theme: list[i].theme };
  }
  // after the listed ones: every SEASON_DAYS days, themes rotate
  const lastEnd = at(list.length - 1) + list[list.length - 1].days * DAY_MS;
  const len = SEASON_DAYS * DAY_MS;
  const k = Math.floor((ts - lastEnd) / len);
  const n = list.length + 1 + k;
  const start = lastEnd + k * len;
  return { n, start, end: start + len, theme: THEMES[(n - 1) % THEMES.length] };
}

/* ------------------------------------------------------------------ levels */
export const MAX_LEVEL = 20;
/** XP needed to go from level n-1 to level n (index = n). Level 1 is reached at 0 XP. Fast start, slow end: total 7 900. */
export const LEVEL_STEP: number[] = [0, 0, ...Array.from({ length: MAX_LEVEL - 1 }, (_, i) => {
  const n = i + 2;
  return n <= 5 ? 100 : n <= 10 ? 250 : n <= 15 ? 450 : 800;
})];
/** Cumulative XP at which level n is reached. */
export const LEVEL_XP: number[] = LEVEL_STEP.reduce<number[]>((acc, step, n) => {
  acc[n] = n === 0 ? 0 : (acc[n - 1] ?? 0) + step;
  return acc;
}, []);

export interface LevelInfo {
  level: number;
  /** XP into the current level */
  into: number;
  /** XP of the current level step (0 at max) */
  step: number;
  /** total XP needed for the next level (null at max) */
  nextAt: number | null;
}
export function levelOf(xp: number): LevelInfo {
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level + 1]) level++;
  if (level === MAX_LEVEL) return { level, into: 0, step: 0, nextAt: null };
  return { level, into: xp - LEVEL_XP[level], step: LEVEL_STEP[level + 1], nextAt: LEVEL_XP[level + 1] };
}

/* ------------------------------------------------------------------ XP rules */
export interface XpRules {
  liveGame: number; // finished game vs a person or a virtual opponent (rated)
  liveWin: number; // extra for winning it
  botGame: number; // any finished game vs the practice bot
  botWin: number; // extra for beating the bot
  firstWin: number; // the first win of the day (person or bot)
  streak: number; // every 7 days of check-ins in a row
  checkin: number; // first visit of the day ("Kirish")
  mission: number; // each daily mission claimed
  missionBonus: number; // all missions of the day claimed
  referral: number; // a new friend joined by the player's invite link
  /** live games a day that give XP win or lose; after them only wins count (no limit) */
  liveGamesPerDay: number;
  /** games vs the same opponent that count per day (no farming between two friends) */
  sameOpponentPerDay: number;
  botGamesPerDay: number;
  botWinsPerDay: number;
  referralsPerDay: number;
  /** most XP a day; 0 = no daily limit */
  dailyCap: number;
  minMoves: number;
  /** Elite owners get +X% XP (whole numbers) */
  eliteBoostPct: number;
}
export const DEFAULT_RULES: XpRules = {
  liveGame: 15,
  liveWin: 25,
  botGame: 5,
  botWin: 10,
  firstWin: 50,
  checkin: 25,
  streak: 100,
  mission: 20,
  missionBonus: 40,
  referral: 100,
  liveGamesPerDay: 20,
  sameOpponentPerDay: 3,
  botGamesPerDay: 15,
  botWinsPerDay: 10,
  referralsPerDay: 2,
  dailyCap: 0,
  minMoves: 12,
  eliteBoostPct: 0,
};

export type XpSource = 'live_game' | 'live_win' | 'bot_game' | 'bot_win' | 'first_win' | 'checkin' | 'streak' | 'mission' | 'mission_bonus' | 'referral';
export interface PassGame {
  ts: number;
  live: boolean; // vs a person / virtual opponent, rated by the server
  outcome: 'win' | 'loss' | 'draw';
  moves: number;
  vsBot: boolean; // practice bot
  /** opponent id / name (same-opponent limit) */
  opp?: string;
}
export interface SeasonActivity {
  games: PassGame[];
  /** Tashkent days with a check-in */
  checkins: string[];
  /** day → missions claimed that day (bonus excluded) */
  missions: Record<string, number>;
  /** days on which the mission bonus was claimed */
  missionBonus: string[];
  /** times new friends joined by the player's invite link */
  referrals: number[];
}
/** a timed XP booster from a pass reward: +pct% on every Tashkent day it touches */
export interface XpBoost {
  pct: number;
  from: number; // UTC ms
  until: number; // UTC ms, exclusive
}
export interface XpLine {
  source: XpSource;
  count: number;
  xp: number;
}
export interface XpResult {
  total: number;
  today: number;
  /** what today's XP came from (before the cap) */
  todayLines: XpLine[];
  capped: boolean;
}

/** The strongest booster that touches this Tashkent day (boosters do not stack with each other). */
export function boostPct(boosts: XpBoost[], day: string): number {
  const t0 = dayStartUtc(day);
  const t1 = t0 + DAY_MS;
  return boosts.filter((b) => b.from < t1 && b.until > t0).reduce((m, b) => Math.max(m, b.pct), 0);
}

/** Season XP: per Tashkent day sum every source, apply the Elite boost, then the daily cap. */
export function seasonXp(a: SeasonActivity, season: Season, r: XpRules, elite: boolean, now: number, boosts: XpBoost[] = []): XpResult {
  const inSeason = (ts: number) => ts >= season.start && ts < season.end;
  // boosters shorter than a day (e.g. +30% for 5 hours) count per event, by its time; day-long ones per day
  const short = boosts.filter((b) => b.until - b.from < DAY_MS);
  const long = boosts.filter((b) => b.until - b.from >= DAY_MS);
  const shortPct = (ts: number) => short.filter((b) => ts >= b.from && ts < b.until).reduce((m, b) => Math.max(m, b.pct), 0);
  const days = new Map<string, Map<XpSource, XpLine>>();
  const timed = new Map<string, Array<[number, number]>>(); // day → [ts, base xp] (for the short boosters)
  const add = (day: string, source: XpSource, xp: number, count = 1, ts?: number) => {
    if (ts !== undefined && short.length) timed.set(day, [...(timed.get(day) ?? []), [ts, xp]]);
    const m = days.get(day) ?? new Map<XpSource, XpLine>();
    const l = m.get(source) ?? { source, count: 0, xp: 0 };
    l.count += count;
    l.xp += xp;
    m.set(source, l);
    days.set(day, m);
  };

  const byDay = new Map<string, PassGame[]>();
  for (const g of a.games) {
    if (!inSeason(g.ts) || g.moves < r.minMoves) continue;
    const d = tashkentDay(g.ts);
    byDay.set(d, [...(byDay.get(d) ?? []), g]);
  }
  for (const [d, games] of byDay) {
    const sorted = [...games].sort((x, y) => x.ts - y.ts);
    // live games (at most M a day against the same opponent): the first N of the day give XP win or lose,
    // after that only wins do — with no limit
    const perOpp = new Map<string, number>();
    const counted = sorted
      .filter((g) => g.live)
      .filter((g) => {
        if (!g.opp) return true;
        const k = (perOpp.get(g.opp) ?? 0) + 1;
        perOpp.set(g.opp, k);
        return k <= r.sameOpponentPerDay;
      });
    const live = counted.filter((g, i) => i < r.liveGamesPerDay || g.outcome === 'win');
    live.forEach((g, i) => {
      if (i < r.liveGamesPerDay) add(d, 'live_game', r.liveGame, 1, g.ts);
      if (g.outcome === 'win') add(d, 'live_win', r.liveWin, 1, g.ts);
    });
    // practice bot: every finished game a little, a win a bit more
    const bot = sorted.filter((g) => g.vsBot && !g.live).slice(0, r.botGamesPerDay);
    let botWins = 0;
    for (const g of bot) {
      add(d, 'bot_game', r.botGame, 1, g.ts);
      if (g.outcome === 'win' && botWins < r.botWinsPerDay) {
        botWins++;
        add(d, 'bot_win', r.botWin, 1, g.ts);
      }
    }
    // the first win of the day (among the games that counted)
    const first = [...live, ...bot].filter((g) => g.outcome === 'win').sort((x, y) => x.ts - y.ts)[0];
    if (first) add(d, 'first_win', r.firstWin, 1, first.ts);
  }
  const ins = [...new Set(a.checkins)].filter((d) => inSeason(dayStartUtc(d))).sort();
  let run = 0;
  for (let i = 0; i < ins.length; i++) {
    const d = ins[i];
    add(d, 'checkin', r.checkin);
    run = i > 0 && dayStartUtc(d) - dayStartUtc(ins[i - 1]) === DAY_MS ? run + 1 : 1;
    if (run % 7 === 0) add(d, 'streak', r.streak); // 7, 14, 21 days in a row
  }
  for (const [d, n] of Object.entries(a.missions)) if (n > 0 && inSeason(dayStartUtc(d))) add(d, 'mission', r.mission * n, n);
  for (const d of new Set(a.missionBonus)) if (inSeason(dayStartUtc(d))) add(d, 'mission_bonus', r.missionBonus);
  // invited friends: at most N a day count
  const refDays = new Map<string, number>();
  for (const ts of a.referrals.filter(inSeason).sort((x, y) => x - y)) {
    const d = tashkentDay(ts);
    const k = (refDays.get(d) ?? 0) + 1;
    refDays.set(d, k);
    if (k <= r.referralsPerDay) add(d, 'referral', r.referral, 1, ts);
  }

  const today = tashkentDay(now);
  let total = 0;
  let todayXp = 0;
  let capped = false;
  for (const [d, m] of days) {
    const raw = [...m.values()].reduce((s, l) => s + l.xp, 0);
    const dayPct = boostPct(long, d);
    const pct = (elite ? r.eliteBoostPct : 0) + dayPct;
    // a short booster stronger than the day's one adds only the difference (no stacking)
    const extra = (timed.get(d) ?? []).reduce((sum, [ts, xp]) => sum + Math.floor((xp * Math.max(0, shortPct(ts) - dayPct)) / 100), 0);
    const boosted = Math.floor((raw * (100 + pct)) / 100) + extra;
    const v = r.dailyCap > 0 ? Math.min(boosted, r.dailyCap) : boosted;
    total += v;
    if (d === today) {
      todayXp = v;
      capped = r.dailyCap > 0 && boosted > r.dailyCap;
    }
  }
  const order: XpSource[] = ['live_game', 'live_win', 'bot_game', 'bot_win', 'first_win', 'checkin', 'streak', 'mission', 'mission_bonus', 'referral'];
  const todayLines = order.map((s) => days.get(today)?.get(s)).filter((l): l is XpLine => !!l);
  return { total, today: todayXp, todayLines, capped };
}

/* ------------------------------------------------------------------ rewards */
export type Track = 'free' | 'elite';
/**
 * coins      — value = amount
 * item       — value = shop item slug (non-limited boards / pieces / effects); owned → fallbackCoins
 * xp_boost   — value = percent, days = duration (from the claim)
 * box        — random coins between min and max; with pool: a random item from the pool (coins when all owned)
 * combo      — value = combo effect id (cb-double / cb-triple): plays on 2 / 3+ captures in one move
 * victory    — value = victory animation id
 * currency   — value = 'crystal' | 'ticket', amount = how many
 * perk       — value = 'mission_slot', amount = +N, days = duration
 * emoji      — value = one or more emoji ids (comma list): status emoji next to the name
 * frame / background / badge — value = cosmetic id
 * title      — value = title id, days = how long (0 = forever)
 */
export type RewardKind = 'coins' | 'item' | 'xp_boost' | 'box' | 'currency' | 'perk' | 'emoji' | 'frame' | 'background' | 'badge' | 'title' | 'combo' | 'victory';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export interface Reward {
  level: number;
  track: Track;
  kind: RewardKind;
  value: string;
  fallbackCoins: number;
  rarity: Rarity;
  label_uz: string;
  label_en: string;
  /** picture of the reward (one file per reward, public/pass/*.webp) */
  art?: string;
  days?: number;
  /** xp_boost: duration in hours (instead of days) */
  hours?: number;
  /** xp_boost: kept in the inventory for this many days; the player turns it on whenever they like */
  keepDays?: number;
  /** box: shop item slugs (comma list) — a random one not owned yet is given; all owned → coins min..max */
  pool?: string;
  min?: number;
  max?: number;
  amount?: number;
  /** what it is in the game, shown in the reward details */
  note_uz?: string;
  note_en?: string;
}
export type CosmeticKind = 'emoji' | 'frame' | 'background' | 'badge' | 'title' | 'combo' | 'victory';
export const COSMETIC_KINDS: CosmeticKind[] = ['emoji', 'frame', 'background', 'badge', 'title', 'combo', 'victory'];
export const isCosmetic = (k: RewardKind): k is CosmeticKind => (COSMETIC_KINDS as string[]).includes(k);
export type Currency = 'crystal' | 'ticket';

type R = Omit<Reward, 'level' | 'track' | 'fallbackCoins' | 'art'> & { fallbackCoins?: number; art?: string };
const F = (level: number, r: R): Reward => ({ fallbackCoins: 0, art: `pass/free-${String(level).padStart(2, '0')}.webp`, ...r, level, track: 'free' });
const P = (level: number, r: R): Reward => ({ fallbackCoins: 0, art: `pass/prem-${String(level).padStart(2, '0')}.webp`, ...r, level, track: 'elite' });
const coinR = (n: number, rarity: Rarity = 'common'): R => ({ kind: 'coins', value: String(n), rarity, label_uz: `${n} Dameo Coin`, label_en: `${n} Dameo Coins` });
const item = (slug: string, fallback: number, rarity: Rarity, uz: string, en: string, nuz: string, nen: string): R => ({
  kind: 'item', value: slug, fallbackCoins: fallback, rarity, label_uz: uz, label_en: en, note_uz: nuz, note_en: nen,
});

/** Season 01 "Royal Legacy" — 20 free + 20 premium rewards (the server's pass_rewards table holds the same rows). */
export const DEFAULT_REWARDS: Reward[] = [
  F(1, coinR(50)),
  F(2, { ...item('pass-stone-classic', 600, 'rare', 'Classic Stone', 'Classic Stone', "Dona skin · oq-oltin va binafsha toj donalar, inventarga tushadi", 'Piece skin · cream-gold and purple crown pieces, goes to your inventory'), art: 'pass/stone-classic.webp' }),
  F(3, { kind: 'xp_boost', value: '10', hours: 3, keepDays: 30, rarity: 'common', label_uz: 'XP Booster +10% (3 soat)', label_en: 'XP Booster +10% (3 hours)', note_uz: "Inventarga tushadi: 30 kun ichida xohlagan paytda yoqing, 3 soat har bir o'yin XP'si +10%", note_en: 'Goes to your inventory: turn it on any time within 30 days, +10% XP per game for 3 hours' }),
  F(4, { kind: 'frame', value: 'f-laurel', rarity: 'rare', label_uz: 'Silver Frame', label_en: 'Silver Frame', note_uz: 'Avatar ramkasi', note_en: 'Avatar frame', art: 'pass/frame-free-laurel.webp' }),
  F(5, coinR(100)),
  F(6, { kind: 'emoji', value: 'em-cool,em-king,em-fire', rarity: 'rare', label_uz: 'Free Emoji Pack', label_en: 'Free Emoji Pack', note_uz: '3 ta emoji — ism yonida ko\'rinadi', note_en: '3 emoji — shown next to your name', art: 'pass/emoji-king.webp' }),
  F(7, { kind: 'background', value: 'bg-simple', rarity: 'common', label_uz: 'Simple Purple', label_en: 'Simple Purple', note_uz: 'Profil foni', note_en: 'Profile background', art: 'pass/card-1.webp' }),
  F(8, { ...item('fx-purple-trail', 1500, 'rare', 'Purple Trail', 'Purple Trail', "Yurish effekti · inventarga tushadi, o'yinda tosh binafsha iz qoldiradi", 'Move effect · goes to your inventory, your piece leaves a purple trail'), art: 'pass/fx-purple-trail.webp' }),
  F(9, { ...item('pass-violet', 250, 'common', 'Classic Violet Board', 'Classic Violet Board', "O'yin doskasi · inventarga tushadi, o'yinda shu doskada o'ynaysiz", 'Game board · goes to your inventory, you play on it in games'), art: 'pass/board-free.webp' }),
  F(10, { kind: 'box', value: 'box-bronze', min: 50, max: 250, rarity: 'rare', label_uz: 'Bronze Chest', label_en: 'Bronze Chest', note_uz: 'Tasodifiy sovg\'a · 50–250 coin', note_en: 'Random gift · 50–250 coins', art: 'pass/free-19.webp' }),
  F(11, coinR(150)),
  F(12, { kind: 'background', value: 'bg-pattern', rarity: 'rare', label_uz: 'Royal Pattern', label_en: 'Royal Pattern', note_uz: 'Profil foni', note_en: 'Profile background', art: 'pass/card-2.webp' }),
  F(13, { kind: 'emoji', value: 'e-win', rarity: 'rare', label_uz: 'WIN Stickers', label_en: 'WIN Stickers', note_uz: '3 ta stiker', note_en: '3 stickers' }),
  F(14, { kind: 'perk', value: 'promo_s02', amount: 10, days: 60, rarity: 'rare', label_uz: 'Season 02 chegirma', label_en: 'Season 02 discount', note_uz: '10% chegirma promo-kod', note_en: '10% discount promo code', art: 'pass/free-08.webp' }),
  F(15, { ...coinR(200), art: 'pass/free-16.webp' }),
  F(16, { kind: 'badge', value: 'b-rookie', rarity: 'rare', label_uz: 'Rookie Badge', label_en: 'Rookie Badge', note_uz: 'Profil belgisi', note_en: 'Profile badge', art: 'pass/free-14.webp' }),
  F(17, { kind: 'title', value: 't-active', days: 7, rarity: 'epic', label_uz: 'Active Player', label_en: 'Active Player', note_uz: '7 kunlik unvon', note_en: '7-day title' }),
  F(18, { ...coinR(250, 'rare'), art: 'pass/free-11.webp' }),
  F(19, { kind: 'box', value: 'box-mystery', min: 150, max: 500, rarity: 'epic', label_uz: 'Mystery Chest', label_en: 'Mystery Chest', note_uz: 'Sirli sovg\'a · 150–500 coin', note_en: 'Mystery gift · 150–500 coins', art: 'pass/free-10.webp' }),
  F(20, { kind: 'badge', value: 'b-s1', rarity: 'epic', label_uz: 'Season 01 Member', label_en: 'Season 01 Member', note_uz: 'Doimiy mavsum belgisi', note_en: 'Permanent season badge' }),

  P(1, coinR(300, 'rare')),
  P(2, { ...item('pass-stone-royal', 2500, 'legendary', 'Royal Stone', 'Royal Stone', "Premium dona skin · ko'k va qizil billur donalar, inventarga tushadi", 'Premium piece skin · blue and red crystal pieces, goes to your inventory'), art: 'pass/stone-royal.webp' }),
  P(3, { kind: 'xp_boost', value: '30', hours: 5, keepDays: 30, rarity: 'epic', label_uz: 'XP Booster +30% (5 soat)', label_en: 'XP Booster +30% (5 hours)', note_uz: "Inventarga tushadi: 30 kun ichida xohlagan paytda yoqing, 5 soat har bir o'yin XP'si +30%", note_en: 'Goes to your inventory: turn it on any time within 30 days, +30% XP per game for 5 hours' }),
  P(4, { kind: 'emoji', value: 'em-hood,em-dragon,em-bolt,em-gem,em-cup', rarity: 'legendary', label_uz: 'Exclusive Emoji Pack', label_en: 'Exclusive Emoji Pack', note_uz: "5 ta premium emoji — ism yonida ko'rinadi", note_en: '5 premium emoji — shown next to your name', art: 'pass/emoji-dragon.webp' }),
  P(5, { ...coinR(500, 'epic'), art: 'pass/prem-11.webp' }),
  P(6, { kind: 'frame', value: 'f-gold-wings', rarity: 'legendary', label_uz: 'Golden Wings Frame', label_en: 'Golden Wings Frame', note_uz: 'Oltin qanotli tojli avatar ramkasi', note_en: 'Golden winged avatar frame with a crown', art: 'pass/frame-prem-goldwings.webp' }),
  P(7, { ...item('pass-royal-gold', 900, 'epic', 'Royal Crown Board', 'Royal Crown Board', "Premium o'yin doskasi · oltin ramka va toj bilan, inventarga tushadi", 'Premium board · gold frame and crown, goes to your inventory'), art: 'pass/board-prem.webp' }),
  P(8, { ...item('fx-royal-lightning', 4000, 'legendary', 'Royal Lightning', 'Royal Lightning', "Premium yurish effekti · oltin-binafsha iz, toj uchqunlari", 'Premium move effect · gold and purple trail with crown sparks'), art: 'pass/fx-royal-lightning.webp' }),
  P(9, { ...coinR(700, 'epic'), art: 'pass/free-01.webp' }),
  P(10, { kind: 'box', value: 'box-epic', pool: 'fx-sparkle,st-sapphire,royal-wood', min: 400, max: 800, rarity: 'legendary', label_uz: 'Epic Chest', label_en: 'Epic Chest', note_uz: "Noyob kosmetik sovg'a: effekt, dona yoki doska (hammasi bor bo'lsa 400–800 coin)", note_en: 'A rare cosmetic: effect, pieces or board (400–800 coins if you own them all)', art: 'pass/free-19.webp' }),
  P(11, { kind: 'background', value: 'bg-throne-hall', rarity: 'legendary', label_uz: 'Royal Throne Hall', label_en: 'Royal Throne Hall', note_uz: 'Premium profil foni: taxt zali', note_en: 'Premium profile background: the throne hall', art: 'pass/bg-throne-hall.webp' }),
  P(12, { kind: 'combo', value: 'cb-double', rarity: 'legendary', label_uz: 'Double Strike', label_en: 'Double Strike', note_uz: "Combo effekti · bir yurishda 2 ta toshni ursangiz, ovozli effekt", note_en: 'Combo effect · capture 2 pieces in one move, with sound', art: 'pass/combo-double.webp' }),
  P(13, { kind: 'victory', value: 'v-royal', rarity: 'legendary', label_uz: 'Victory Animation', label_en: 'Victory Animation', note_uz: "Maxsus g'alaba animatsiyasi: toj, nur va oltin uchqunlar", note_en: 'Special victory animation: crown, rays and gold sparks', art: 'pass/prem-19.webp' }),
  P(14, { kind: 'perk', value: 'promo_s02_20', amount: 20, days: 60, rarity: 'epic', label_uz: "Season 02 uchun 20% chegirma", label_en: '20% off Season 02', note_uz: 'Promo-kod hisobingizga yoziladi', note_en: 'The promo code is saved to your account', art: 'pass/prem-15.webp' }),
  P(15, { ...coinR(1000, 'legendary'), art: 'pass/free-05.webp' }),
  P(16, { kind: 'badge', value: 'b-legend', rarity: 'legendary', label_uz: 'Legendary Badge', label_en: 'Legendary Badge', note_uz: 'Maxsus profil belgisi', note_en: 'Special profile badge', art: 'pass/prem-18.webp' }),
  P(17, { kind: 'title', value: 't-royal', days: 30, rarity: 'legendary', label_uz: 'Royal Player', label_en: 'Royal Player', note_uz: '30 kunlik maxsus unvon', note_en: '30-day special title', art: 'pass/prem-09.webp' }),
  P(18, { kind: 'combo', value: 'cb-triple', rarity: 'mythic', label_uz: 'Triple Strike', label_en: 'Triple Strike', note_uz: "Combo effekti · bir yurishda 3 va undan ko'p toshni ursangiz", note_en: 'Combo effect · capture 3 or more pieces in one move', art: 'pass/combo-triple.webp' }),
  P(19, { kind: 'frame', value: 'f-crown-wings', rarity: 'mythic', label_uz: 'Royal Crown Frame', label_en: 'Royal Crown Frame', note_uz: 'Animatsiyali eng oliy avatar ramkasi: binafsha qanotlar va toj', note_en: 'The top animated avatar frame: purple wings and a crown', art: 'pass/frame-prem-crownwings.webp' }),
  P(20, { kind: 'badge', value: 'b-s1-gold', rarity: 'mythic', label_uz: 'Season 01 Premium', label_en: 'Season 01 Premium', note_uz: 'Eksklyuziv doimiy belgi', note_en: 'Exclusive permanent badge', art: 'pass/prem-17.webp' }),
];

/**
 * Where the empty hole of each frame picture is (fractions of the square picture), measured from the artwork.
 * The avatar is fitted exactly into this hole, so every frame looks the same size around it.
 */
export const FRAME_FIT: Record<string, { x: number; y: number; w: number; h: number }> = {
  'f-laurel': { x: 0.1406, y: 0.1938, w: 0.7219, h: 0.6219 },
  'f-wings': { x: 0.2437, y: 0.2, w: 0.5219, h: 0.5687 },
  'f-royal-wings': { x: 0.175, y: 0.2062, w: 0.5687, h: 0.5094 },
  'f-gold-wings': { x: 0.2522, y: 0.2727, w: 0.5015, h: 0.5015 },
  'f-crown-wings': { x: 0.2533, y: 0.3093, w: 0.4853, h: 0.4373 },
};

/** picture of a cosmetic by id */
export const COSMETIC_ART: Record<string, string> = {
  'f-laurel': 'pass/frame-free-laurel.webp',
  'f-wings': 'pass/frame-prem-wings.webp',
  'f-royal-wings': 'pass/frame-prem-royal.webp',
  'f-gold-wings': 'pass/frame-prem-goldwings.webp',
  'f-crown-wings': 'pass/frame-prem-crownwings.webp',
  'b-rookie': 'pass/free-14.webp',
  'b-s1': 'pass/free-20.webp',
  'b-s1-gold': 'pass/prem-17.webp',
  'b-legend': 'pass/prem-18.webp',
  'cb-double': 'pass/combo-double.webp',
  'cb-triple': 'pass/combo-triple.webp',
  'v-royal': 'pass/prem-19.webp',
  'bg-simple': 'pass/bg-simple.webp',
  'bg-pattern': 'pass/bg-pattern.webp',
  'bg-laurel': 'pass/bg-laurel.webp',
  'bg-throne': 'pass/hall-throne.webp',
  'bg-throne-hall': 'pass/bg-throne-hall.webp',
};

/** status emoji pictures (shown next to the name) */
export const EMOJI_ART: Record<string, string> = {
  'em-cool': 'pass/emoji-cool.webp',
  'em-king': 'pass/emoji-king.webp',
  'em-fire': 'pass/emoji-fire.webp',
  'em-hood': 'pass/emoji-hood.webp',
  'em-dragon': 'pass/emoji-dragon.webp',
  'em-bolt': 'pass/emoji-bolt.webp',
  'em-gem': 'pass/emoji-gem.webp',
  'em-cup': 'pass/emoji-cup.webp',
  'e-win': 'pass/free-13.webp',
};

export interface PassPrice {
  /** old so'm price (not shown: digital goods in Telegram are sold for Stars) */
  som: number;
  /** Premium price in Telegram Stars */
  stars: number;
  /** price before the discount (struck through); the discount is shown as a percent */
  starsBefore?: number;
}
export const DEFAULT_PRICE: PassPrice = { som: 11_900, stars: 50, starsBefore: 55 };
/** who opens Premium for players paying in so'm (they write to this Telegram account, the admin gives Premium) */
export const PASS_ADMIN_USERNAME = 'Flect_stars';
/** discount in whole percent (55 → 50 = 10%) */
export const priceDiscount = (p: PassPrice) => (p.starsBefore && p.starsBefore > p.stars ? Math.ceil((1 - p.stars / p.starsBefore) * 100) : 0);

/** Coins a reward pays now (a box needs its roll; an owned item pays its fallback). */
export function rewardCoins(r: Reward, alreadyOwned: boolean, roll = 0): number {
  if (r.kind === 'coins') return Number(r.value) || 0;
  if (r.kind === 'item') return alreadyOwned ? r.fallbackCoins : 0;
  if (r.kind === 'box') {
    const lo = r.min ?? 0;
    const hi = Math.max(lo, r.max ?? lo);
    return lo + Math.floor(Math.max(0, Math.min(0.999999, roll)) * (hi - lo + 1));
  }
  return 0;
}

/** Sum of fixed coins a track pays (boxes at their average, items as not owned). */
export const trackCoins = (rewards: Reward[], track: Track) =>
  rewards
    .filter((r) => r.track === track)
    .reduce((s, r) => s + (r.kind === 'box' ? (r.pool ? 0 : ((r.min ?? 0) + (r.max ?? 0)) / 2) : rewardCoins(r, false)), 0);

/* ------------------------------------------------------------------ board (what the UI shows) */
export type RewardState = 'locked' | 'ready' | 'claimed' | 'elite_locked';
export interface RewardView extends Reward {
  state: RewardState;
}
export interface PassBoard {
  season: Season;
  xp: number;
  level: LevelInfo;
  elite: boolean;
  price: PassPrice;
  today: XpResult;
  checkedInToday: boolean;
  rewards: RewardView[];
  readyCount: number;
  /** strongest XP booster active today (percent) */
  boostToday: number;
  /** XP really earned this season (the beta "everything open" switch does not change it) */
  earned: number;
}

export const claimKey = (level: number, track: Track) => `${track}:${level}`;

export function buildPass(
  season: Season,
  a: SeasonActivity,
  rules: XpRules,
  rewards: Reward[],
  claims: string[],
  elite: boolean,
  price: PassPrice,
  now: number,
  boosts: XpBoost[] = [],
  /** beta showcase: treat the season as finished (every level reached) */
  allOpen = false,
): PassBoard {
  const xp = seasonXp(a, season, rules, elite, now, boosts);
  const earned = xp.total;
  // the XP bar always shows what was really earned; the beta "everything open" switch only unlocks the rewards
  const lv = levelOf(xp.total);
  const openTo = allOpen ? MAX_LEVEL : lv.level;
  const done = new Set(claims);
  const views = [...rewards]
    .sort((x, y) => x.level - y.level || (x.track === y.track ? 0 : x.track === 'free' ? -1 : 1))
    .map((r): RewardView => {
      const k = claimKey(r.level, r.track);
      const state: RewardState = done.has(k)
        ? 'claimed'
        : r.level > openTo
          ? 'locked'
          : r.track === 'elite' && !elite
            ? 'elite_locked'
            : 'ready';
      return { ...r, state };
    });
  return {
    season,
    xp: xp.total,
    level: lv,
    elite,
    price,
    today: xp,
    checkedInToday: a.checkins.includes(tashkentDay(now)),
    rewards: views,
    readyCount: views.filter((v) => v.state === 'ready').length,
    earned,
    boostToday:
      Math.max(
        boostPct(boosts.filter((b) => b.until - b.from >= DAY_MS), tashkentDay(now)),
        boosts.filter((b) => b.until - b.from < DAY_MS && now >= b.from && now < b.until).reduce((m, b) => Math.max(m, b.pct), 0),
      ) + (elite ? rules.eliteBoostPct : 0),
  };
}

export type PassClaimError = 'unknown' | 'locked' | 'elite' | 'already';
export type PassClaimCheck = { ok: true; reward: Reward } | { ok: false; error: PassClaimError };
export function checkPassClaim(board: PassBoard, level: number, track: Track): PassClaimCheck {
  const r = board.rewards.find((x) => x.level === level && x.track === track);
  if (!r) return { ok: false, error: 'unknown' };
  if (r.state === 'claimed') return { ok: false, error: 'already' };
  if (r.state === 'locked') return { ok: false, error: 'locked' };
  if (r.state === 'elite_locked') return { ok: false, error: 'elite' };
  return { ok: true, reward: r };
}
