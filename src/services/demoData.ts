/**
 * SAMPLE DATA — every record here is fictional and flagged `demo: true`.
 * It exists only so the UI is explorable without a backend and is always
 * labelled "Demo" in the interface. It is never presented as real players.
 */
import type { LiveMatch, Player, Tournament } from '../types/models.ts';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'Sardor', 'Malika', 'Jasur', 'Nilufar', 'Bekzod', 'Dilnoza', 'Otabek', 'Zarina', 'Azizbek', 'Madina',
  'Timur', 'Aigerim', 'Marat', 'Elena', 'Kenji', 'Mei', 'Lucas', 'Sofia', 'Oleg', 'Anya',
  'Rustam', 'Gulnora', 'Shaxzod', 'Feruza', 'Akmal', 'Laylo', 'Ilhom', 'Sevara', 'Davron', 'Nodira',
  'Arman', 'Dina', 'Emre', 'Leyla', 'Pavel', 'Irina', 'Hugo', 'Clara', 'Noah', 'Aisha',
  'Behruz', 'Kamola', 'Sherzod', 'Robiya', 'Umid', 'Muniza', 'Javlon', 'Barno', 'Farhod', 'Shahlo',
  'Diyor', 'Mohira', 'Sanjar', 'Lola', 'Ravshan', 'Zilola', 'Anvar', 'Kamila', 'Jahongir', 'Aziza',
];
const TAGS = ['Pro', 'King', 'Dama', 'Move', 'Chess64', 'Queen', 'Master', 'Fox', 'Wolf', 'Star', 'Flash', 'Rook', 'Crown', 'Samarqand', 'Buxoro'];
const COUNTRIES = ['UZ', 'UZ', 'UZ', 'UZ', 'KZ', 'TR', 'RU', 'KG', 'DE', 'JP', 'US', 'FR', 'AZ', 'TJ'];

export const DEMO_NOW = Date.now();

export function makeDemoPlayers(): Player[] {
  const rnd = mulberry32(20261028);
  const out: Player[] = [];
  const used = new Set<string>();
  for (let i = 0; i < NAMES.length; i++) {
    let username = `${NAMES[i]}_${TAGS[Math.floor(rnd() * TAGS.length)]}`;
    while (used.has(username)) username += Math.floor(rnd() * 9);
    used.add(username);
    // rating curve: a few strong players, many in the middle
    const skill = Math.pow(rnd(), 1.6);
    const rating = Math.round(1000 + skill * 1100);
    const games = Math.round(30 + rnd() * 520);
    const winRate = Math.min(0.82, Math.max(0.28, 0.32 + (rating - 1000) / 2400 + (rnd() - 0.5) * 0.1));
    const draws = Math.round(games * (0.04 + rnd() * 0.08));
    const wins = Math.round((games - draws) * winRate);
    const losses = games - draws - wins;
    const online = rnd() < 0.35;
    out.push({
      id: `demo-${i + 1}`,
      username,
      avatar: `${Math.floor(rnd() * 360)}:${i}`,
      rating,
      wins,
      losses,
      draws,
      lastSeen: DEMO_NOW - (online ? Math.floor(rnd() * 60_000) : 5 * 60_000 + Math.floor(rnd() * 3 * 86_400_000)),
      country: COUNTRIES[Math.floor(rnd() * COUNTRIES.length)],
      demo: true,
      lastDelta: Math.round((rnd() - 0.42) * 28),
    });
  }
  return out.sort((a, b) => b.rating - a.rating);
}

export const DEMO_PLAYERS: Player[] = makeDemoPlayers();

export const ONLINE_WINDOW_MS = 2 * 60_000;
export const isOnline = (p: Pick<Player, 'lastSeen'>, now = Date.now()) => now - p.lastSeen < ONLINE_WINDOW_MS;

/** Sample friends / incoming requests used by the demo friends page. */
export const DEMO_FRIEND_IDS = ['demo-4', 'demo-9', 'demo-15', 'demo-22'];
export const DEMO_INCOMING_IDS = ['demo-7', 'demo-31'];

export function demoLiveMatches(): LiveMatch[] {
  const p = DEMO_PLAYERS;
  const pairs: Array<[number, number, number]> = [
    [0, 3, 34],
    [5, 8, 21],
    [11, 2, 47],
    [14, 19, 12],
  ];
  return pairs.map(([a, b, moves], i) => ({
    id: `demo-live-${i}`,
    white: p[a].username,
    black: p[b].username,
    whiteRating: p[a].rating,
    blackRating: p[b].rating,
    moves,
    demo: true,
  }));
}

const H = 3_600_000;
const D = 24 * H;
export function demoTournaments(now = Date.now()): Tournament[] {
  const winners = DEMO_PLAYERS;
  return [
    { id: 'demo-t1', name: 'DAMEO Weekend Open', startsAt: now + 2 * D, capacity: 64, participants: 41, status: 'upcoming', format: 'single_elimination', bestOf: 1, demo: true },
    { id: 'demo-t2', name: 'Samarqand Cup', startsAt: now + 5 * D, capacity: 32, participants: 19, status: 'upcoming', format: 'swiss', bestOf: 1, demo: true },
    { id: 'demo-t3', name: 'Beginners Blitz', startsAt: now + 9 * D, capacity: 128, participants: 57, status: 'upcoming', format: 'round_robin', bestOf: 1, demo: true },
    { id: 'demo-t4', name: 'Silk Road Masters', startsAt: now - 2 * H, capacity: 32, participants: 32, status: 'in_progress', format: 'single_elimination', bestOf: 3, demo: true },
    { id: 'demo-t5', name: 'Midweek Swiss', startsAt: now - 1 * H, capacity: 24, participants: 24, status: 'in_progress', format: 'swiss', bestOf: 1, demo: true },
    { id: 'demo-t6', name: 'Autumn Grand Prix', startsAt: now - 6 * D, capacity: 64, participants: 64, status: 'completed', format: 'single_elimination', bestOf: 3, demo: true, winner: winners[0].username },
    { id: 'demo-t7', name: 'Registan Open', startsAt: now - 13 * D, capacity: 32, participants: 30, status: 'completed', format: 'swiss', bestOf: 1, demo: true, winner: winners[2].username },
  ];
}
