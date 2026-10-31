/**
 * DAMEO rating system — Elo with a provisional period.
 *
 *   expected = 1 / (1 + 10 ^ ((opponent - player) / 400))
 *   new      = player + K * (score - expected)      score: win 1, draw 0.5, loss 0
 *
 *   K = 40 for a player's first 20 rated games (provisional), otherwise 24.
 *   Starting rating: 1200. Floor: 100. Results are rounded to whole points.
 *
 * Only VALIDATED competitive games change ratings. Practice games, bot games
 * and local pass-and-play never do. In backend mode the same formula lives in
 * the SQL function `apply_match_result` (supabase/migrations/0002_functions.sql),
 * which only the server (service role) can call — the browser never submits a rating.
 */
export const START_RATING = 1200;
export const RATING_FLOOR = 100;

export type Score = 1 | 0.5 | 0;

export function kFactor(ratedGames: number): number {
  return ratedGames < 20 ? 40 : 24;
}

export function expectedScore(player: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - player) / 400));
}

export function ratingDelta(player: number, opponent: number, score: Score, ratedGames: number): number {
  const raw = kFactor(ratedGames) * (score - expectedScore(player, opponent));
  const next = Math.max(RATING_FLOOR, Math.round(player + raw));
  return next - player;
}

export function levelForRating(rating: number): 'beginner' | 'amateur' | 'advanced' | 'expert' | 'master' {
  if (rating < 1100) return 'beginner';
  if (rating < 1350) return 'amateur';
  if (rating < 1600) return 'advanced';
  if (rating < 1900) return 'expert';
  return 'master';
}
