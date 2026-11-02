/**
 * DAMEO Weekly Tournament (server: supabase/migrations/0010_weekly_tournament.sql).
 * The score is the player's global rating change from player-vs-player games during the week; everything is
 * computed and frozen on the server — the client only reads and joins.
 */
import { db } from './supabase.ts';

export interface WeeklyMe {
  joined: boolean;
  start_rating?: number;
  delta?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  games?: number;
  rank?: number | null;
  joined_at?: string;
}
export interface WeeklyWinner {
  rank: number;
  user_id: string;
  username: string;
  avatar: string;
  delta: number;
  rating: number;
  wins: number;
  losses: number;
  games: number;
}
export interface WeeklyOverview {
  current: { id: string; name: string; week_start: string; starts_at: string; ends_at: string; status: 'active' | 'finished'; participants: number };
  me: WeeklyMe;
  previous: { id: string; name: string; starts_at: string; ends_at: string; winners: WeeklyWinner[] | null } | null;
  next_starts_at: string;
  server_now: string;
}
export interface WeeklyRow {
  rank: number | null;
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
  start_rating: number;
  delta: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  joined_at: string;
  frozen: boolean;
}

export const weeklyOverview = () => db.rpc<WeeklyOverview>('weekly_overview');
export const weeklyStandings = (tournamentId?: string) =>
  db.rpc<WeeklyRow[]>('weekly_standings', tournamentId ? { p_tournament: tournamentId, p_limit: 200 } : { p_limit: 200 });
export const weeklyJoin = () => db.rpc<{ tournament_id: string; joined_at: string; start_rating: number }>('weekly_join');

/** Prizes by final place (1–5). */
export const WEEKLY_PRIZES = [
  { place: 1, icon: '👑', key: 'weekly.prize1' },
  { place: 2, icon: '⭐', key: 'weekly.prize2' },
  { place: 3, icon: '🧸', key: 'weekly.prize3' },
  { place: 4, icon: '🧸', key: 'weekly.prize3' },
  { place: 5, icon: '🧸', key: 'weekly.prize3' },
] as const;
export const PRIZE_PLACES = WEEKLY_PRIZES.length;

/* ----------------------------- time (always Asia/Tashkent) ----------------------------- */
const TZ = 'Asia/Tashkent';
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const UZ_DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

function partsInTashkent(ts: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(ts)
      .map((x) => [x.type, x.value]),
  );
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month - 1, d: +p.day, hh: p.hour, mm: p.minute, wd };
}

/** "Dushanba, 9-noyabr, 00:00" / "Mon, 9 Nov, 00:00" — Tashkent time on every device. */
export function formatTashkent(ts: number, lang: 'uz' | 'en', withTime = true): string {
  const x = partsInTashkent(ts);
  if (lang === 'en') {
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(ts);
    return withTime ? `${s}, ${x.hh}:${x.mm}` : s;
  }
  const s = `${UZ_DAYS[x.wd]}, ${x.d}-${UZ_MONTHS[x.m]}`;
  return withTime ? `${s}, ${x.hh}:${x.mm}` : s;
}

/** "2–8 noyabr" / "2–8 Nov" for a week given its start and (exclusive) end. */
export function formatWeekRange(startTs: number, endTs: number, lang: 'uz' | 'en'): string {
  const a = partsInTashkent(startTs);
  const b = partsInTashkent(endTs - 1000);
  const mon = (m: number) => (lang === 'uz' ? UZ_MONTHS[m] : new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(2026, m, 1)));
  return a.m === b.m ? `${a.d}–${b.d} ${mon(a.m)}` : `${a.d} ${mon(a.m)} – ${b.d} ${mon(b.m)}`;
}

/** Splits a duration into d / h / m / s for the countdown. */
export function splitDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
