/**
 * Local demo profile — lives ONLY in this browser (localStorage).
 * Used when no backend is configured. Rating/stats here are clearly labelled
 * "demo" in the UI and never leave the device.
 */
import type { AppNotification, MatchSummary, Player, RatingPoint } from '../types/models.ts';
import { readJSON, removeKey, writeJSON } from './localStore.ts';
import { START_RATING } from './rating.ts';

export const LOCAL_KEY = 'dameo.local.v1';
export const LOCAL_ID = 'local';

export interface LocalProfile {
  id: typeof LOCAL_ID;
  username: string;
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  ratedGames: number;
  lastDelta: number;
  createdAt: number;
  matches: MatchSummary[];
  history: RatingPoint[];
  friends: string[];
  outgoing: string[];
  handledIncoming: string[];
  tournaments: string[];
  notifications: AppNotification[];
}

export function newLocalProfile(): LocalProfile {
  const tag = Math.floor(1000 + Math.random() * 9000);
  const now = Date.now();
  return {
    id: LOCAL_ID,
    username: `Mehmon${tag}`,
    avatar: `${Math.floor(Math.random() * 360)}:${tag}`,
    rating: START_RATING,
    wins: 0,
    losses: 0,
    draws: 0,
    ratedGames: 0,
    lastDelta: 0,
    createdAt: now,
    matches: [],
    history: [{ ts: now, rating: START_RATING }],
    friends: [],
    outgoing: [],
    handledIncoming: [],
    tournaments: [],
    notifications: [],
  };
}

export function loadLocal(): LocalProfile {
  const stored = readJSON<LocalProfile | null>(LOCAL_KEY, null);
  if (stored && stored.id === LOCAL_ID) return { ...newLocalProfile(), ...stored };
  const fresh = newLocalProfile();
  writeJSON(LOCAL_KEY, fresh);
  return fresh;
}

export const saveLocal = (p: LocalProfile) => writeJSON(LOCAL_KEY, p);
export const clearLocal = () => removeKey(LOCAL_KEY);

export function localAsPlayer(p: LocalProfile): Player {
  return {
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    rating: p.rating,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    lastSeen: Date.now(),
    demo: true,
    lastDelta: p.lastDelta,
  };
}

/** Validate a username: 3–20 chars, letters/digits/underscore/dot. Returns an i18n error key or null. */
export function validateUsername(name: string): 'validation.usernameShort' | 'validation.usernameLong' | 'validation.usernameChars' | null {
  const n = name.trim();
  if (n.length < 3) return 'validation.usernameShort';
  if (n.length > 20) return 'validation.usernameLong';
  if (!/^[\p{L}\p{N}_.]+$/u.test(n)) return 'validation.usernameChars';
  return null;
}
