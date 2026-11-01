/**
 * DAMEO rating — simple and transparent:
 *   win +5 · loss −5 · draw 0 · start 1200 · floor 100
 * Counts for validated online games: human vs human, and human vs the server-side bot.
 * Practice and same-device games never change the rating.
 * The server applies it in SQL (rating_delta / apply_match_result, migration 0003);
 * the browser never submits a rating.
 */
export const START_RATING = 1200;
export const RATING_FLOOR = 100;
export const WIN_POINTS = 5;

export type Score = 1 | 0.5 | 0;

export function ratingDelta(player: number, _opponent: number, score: Score, _ratedGames = 0): number {
  const change = score === 1 ? WIN_POINTS : score === 0 ? -WIN_POINTS : 0;
  return Math.max(RATING_FLOOR, player + change) - player;
}

export function levelForRating(rating: number): 'beginner' | 'amateur' | 'advanced' | 'expert' | 'master' {
  if (rating < 1100) return 'beginner';
  if (rating < 1350) return 'amateur';
  if (rating < 1600) return 'advanced';
  if (rating < 1900) return 'expert';
  return 'master';
}
