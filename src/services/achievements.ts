import { db } from './supabase.ts';
import type { MatchSummary, Player, RatingPoint } from '../types/models.ts';

export type AchievementId = 'firstWin' | 'tenGames' | 'streak3' | 'rating1400' | 'beatHard' | 'firstDraw' | 'veteran';

export interface Achievement {
  id: AchievementId;
  unlocked: boolean;
  /** 0..1 progress towards unlocking */
  progress: number;
}

export function computeAchievements(p: Pick<Player, 'wins' | 'losses' | 'draws'>, matches: MatchSummary[], history: RatingPoint[]): Achievement[] {
  // all recorded games count (rated or not); totals from the profile cover rated games of other players
  const mWins = matches.filter((m) => m.result === 'win').length;
  const mDraws = matches.filter((m) => m.result === 'draw').length;
  const wins = Math.max(p.wins, mWins);
  const draws = Math.max(p.draws, mDraws);
  const games = Math.max(p.wins + p.losses + p.draws, matches.length);
  const peak = history.reduce((m, h) => Math.max(m, h.rating), 0);
  // matches are newest-first
  let best = 0;
  let run = 0;
  for (const m of [...matches].reverse()) {
    run = m.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const beatHard = matches.some((m) => m.mode === 'bot' && m.difficulty === 'hard' && m.result === 'win');
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return [
    { id: 'firstWin', unlocked: wins >= 1, progress: clamp(wins) },
    { id: 'tenGames', unlocked: games >= 10, progress: clamp(games / 10) },
    { id: 'streak3', unlocked: best >= 3, progress: clamp(best / 3) },
    { id: 'rating1400', unlocked: peak >= 1400, progress: clamp((peak - 1000) / 400) },
    { id: 'beatHard', unlocked: beatHard, progress: beatHard ? 1 : 0 },
    { id: 'firstDraw', unlocked: draws >= 1, progress: clamp(draws) },
    { id: 'veteran', unlocked: games >= 50, progress: clamp(games / 50) },
  ];
}

/* ---------------------------------------------------------------- win-streak achievements (server, with coin rewards) */

export type StreakCode = 'first_win' | 'streak_3' | 'streak_5' | 'streak_10';
export interface ServerAchievement {
  code: StreakCode;
  need: number;
  reward: number;
  kind: 'wins' | 'streak';
  progress: number;
  unlocked_at: string | null;
}
export interface MyAchievements {
  current_streak: number;
  best_streak: number;
  wins: number;
  items: ServerAchievement[];
}
/** unlocked / progress / rewards — rewards are paid by the server, once */
export const achievementsMine = () => db.rpc<MyAchievements>('achievements_mine');
/** what a finished game unlocked for me (end-of-game congratulations) */
export const achievementsForMatch = (matchId: string) => db.rpc<Array<{ code: StreakCode; reward: number }>>('achievements_for_match', { p_match: matchId });
