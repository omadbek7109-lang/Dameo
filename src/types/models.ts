export interface Player {
  id: string;
  username: string;
  /** deterministic avatar seed (hue + glyph); no external images */
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  /** epoch ms of last activity */
  lastSeen: number;
  country?: string;
  /** true for sample players shipped with the demo build */
  demo?: boolean;
  /** rating change from the player's most recent rated game */
  lastDelta?: number;
}

export type MatchResult = 'win' | 'loss' | 'draw';
export type MatchMode = 'bot' | 'practice' | 'local' | 'demo-rated' | 'online';

export interface MatchSummary {
  id: string;
  ts: number;
  opponent: string;
  mode: MatchMode;
  result: MatchResult;
  /** rating change; 0 for unrated games */
  delta: number;
  rated: boolean;
  moves: number;
  difficulty?: string;
  demo?: boolean;
}

export interface RatingPoint {
  ts: number;
  rating: number;
}

export type TournamentStatus = 'upcoming' | 'in_progress' | 'completed';
export interface Tournament {
  id: string;
  name: string;
  startsAt: number;
  capacity: number;
  participants: number;
  status: TournamentStatus;
  format: 'single_elimination' | 'swiss' | 'round_robin';
  bestOf: 1 | 3;
  demo?: boolean;
  winner?: string;
  registered?: boolean;
}

export interface LiveMatch {
  id: string;
  white: string;
  black: string;
  whiteRating: number;
  blackRating: number;
  moves: number;
  demo?: boolean;
}

export interface FriendRequest {
  id: string;
  from: Player;
  demo?: boolean;
}

export interface AppNotification {
  id: string;
  ts: number;
  kind: 'rating' | 'friend' | 'tournament' | 'system';
  text: string;
  read: boolean;
  /** optional in-app route, e.g. a game invitation */
  href?: string;
}
