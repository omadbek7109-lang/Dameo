/**
 * DAMEO missions (server: supabase/migrations/0032_missions.sql, edge function `missions`).
 * Progress and rewards are computed on the server; the client only asks to claim a mission by its key.
 */
import { db } from './supabase.ts';

export type DailyKey = 'd_wins3' | 'd_invite' | 'd_bot_medium' | 'd_streak3' | 'd_games5' | 'd_bonus';
export type OnceKey = 'o_games10' | 'o_games50' | 'o_games100' | 'o_wins50' | 'o_wins100' | 'o_wins200';

export interface MissionRow<K extends string = string> {
  key: K;
  target: number;
  reward: number;
  progress: number;
  done: boolean;
  claimed?: boolean;
}
export interface MissionChannel {
  id: number;
  title: string;
  username: string | null;
  link: string | null;
  reward: number;
  verified: boolean;
  verified_at: string | null;
}
export interface MissionHistory {
  mission: string;
  reward: number;
  claimed_at: string;
  title: string | null;
}
export interface MissionsOverview {
  day: string;
  resets_at: string;
  server_now: string;
  balance: number;
  has_telegram: boolean;
  daily: MissionRow<DailyKey>[];
  once: MissionRow<OnceKey>[];
  channels: MissionChannel[];
  history: MissionHistory[];
}
export type ClaimResult = { ok: true; mission: string; coins: number; balance: number } | { ok: false; reason: 'claimed' | 'not-done' | 'unknown' };
export type ChannelState = 'member' | 'not_member' | 'unavailable' | 'error' | 'claimed' | 'inactive' | 'no-telegram';
export interface ChannelResult {
  ok: boolean;
  state: ChannelState;
  coins?: number;
  balance?: number;
  reward?: number;
}

export const missionsOverview = () => db.rpc<MissionsOverview>('missions_overview');
export const missionClaim = (key: string) => db.rpc<ClaimResult>('mission_claim', { p_mission: key });
export const channelCheck = (id: number) => db.invokeFunction<ChannelResult>('missions', { action: 'check', channel_id: id });
export const channelClaim = (id: number) => db.invokeFunction<ChannelResult>('missions', { action: 'claim', channel_id: id });

/** Public channel avatar (Telegram serves it for public @usernames); the UI falls back to initials. */
export const channelAvatar = (username: string | null) => (username ? `https://t.me/i/userpic/320/${username}.jpg` : null);

/* ---------------------------------------------------------------- admin */
export interface AdminChannel {
  id: number;
  chat_id: string;
  title: string;
  username: string | null;
  invite_link: string | null;
  reward: number;
  active: boolean;
  bot_ok: boolean | null;
  bot_status: string | null;
  bot_checked_at: string | null;
  rewarded: number;
  coins_paid: number;
}
export interface ChannelProbe {
  ok: boolean;
  found: boolean;
  error?: string;
  chat_id?: string;
  numeric_id?: string;
  title?: string;
  username?: string | null;
  invite_link?: string | null;
  bot_admin?: boolean;
  bot_status?: string;
}
export const adminChannels = () => db.rpc<AdminChannel[]>('admin_channels_list');
export const adminChannelSave = (c: { id: number | null; chat_id: string; title: string; username: string; invite_link: string; reward: number; active: boolean }, reason: string) =>
  db.rpc<{ ok: boolean; id: number }>('admin_channel_save', {
    p_id: c.id,
    p_chat_id: c.chat_id,
    p_title: c.title,
    p_username: c.username,
    p_invite_link: c.invite_link,
    p_reward: c.reward,
    p_active: c.active,
    p_reason: reason,
  });
export const adminChannelDelete = (id: number, reason: string) => db.rpc('admin_channel_delete', { p_id: id, p_reason: reason });
export const adminChannelProbe = (chat: string, channelId?: number) => db.invokeFunction<ChannelProbe>('missions', { action: 'probe', chat, channel_id: channelId });
