import { db } from './supabase.ts';
import { botUsername, DAMEO_BOT, tg } from './telegram.ts';

export { DAMEO_BOT };

export interface ReferralFriend {
  username: string;
  avatar: string;
  status: 'pending' | 'rewarded';
  games: number;
  created_at: string;
  rewarded_at: string | null;
  /** coins this friend has earned me so far (20 on joining, +30 after their games) */
  earned: number;
}
export interface ReferralOverview {
  code: string;
  invited: number;
  successful: number;
  pending: number;
  earned: number;
  pending_coins: number;
  /** paid to me when a friend joins */
  reward_join: number;
  /** paid to me when that friend has finished `games_needed` real games */
  reward_games: number;
  games_needed: number;
  friends: ReferralFriend[];
}

/** Everything the Referral page shows; the code is created on the server on first use. */
export async function referralOverview(): Promise<ReferralOverview> {
  const r = await db.rpc<ReferralOverview>('referral_overview');
  if (!r || typeof r.code !== 'string') throw new Error('no-data');
  return { ...r, friends: Array.isArray(r.friends) ? r.friends : [] };
}

/** Telegram Mini App deep link — the only way a referral works (no web URL). */
export function referralLink(code: string): string {
  return `https://t.me/${botUsername() || DAMEO_BOT}?startapp=ref_${code}`;
}

/** "ref_<CODE>" from the Telegram launch (start_param), or null. */
export function startRefCode(): string | null {
  const p = tg?.initDataUnsafe?.start_param ?? '';
  const m = /^ref_([A-Za-z2-9]{8})$/.exec(p);
  return m ? m[1].toUpperCase() : null;
}

/** Telegram's share sheet (pick a chat) with the link and a short text. Returns false outside Telegram. */
export function shareReferral(link: string, text: string): boolean {
  if (!tg?.openTelegramLink) return false;
  try {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return true;
  } catch {
    return false;
  }
}
