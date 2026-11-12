/**
 * DAMEO daily rating (server: supabase/migrations/0031_daily_rating.sql).
 * Points = the rating points a player WON in rated games during the current Tashkent day (losses are not subtracted).
 * Everything is computed on the server; the client only reads.
 */
import { db } from './supabase.ts';

export interface DailyRow {
  rank: number;
  user_id: string;
  username: string;
  avatar: string;
  rating: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
}
export interface DailyMe {
  rank: number | null;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  username: string;
  avatar: string;
  rating: number;
}
export interface DailyYesterday {
  day: string;
  user_id: string;
  username: string;
  avatar: string;
  points: number;
  wins: number;
  games: number;
}
export interface DailyOverview {
  day: string;
  starts_at: string;
  ends_at: string;
  players: number;
  top: DailyRow[];
  me: DailyMe | null;
  yesterday: DailyYesterday | null;
  server_now: string;
}

export const dailyOverview = () => db.rpc<DailyOverview>('daily_overview');
