/**
 * DAMEO Pass API. Every number comes from SQL functions (supabase/migrations/0041_season_pass.sql:
 * pass_me / pass_checkin / pass_claim / pass_equip / pass_worn / pass_boosters / pass_booster_use);
 * the browser only asks. Premium: 50 Telegram Stars (Edge Function `payments`, action 'pass_premium') or given by an admin.
 */
import { db } from '../supabase.ts';
import {
  DEFAULT_REWARDS,
  DEFAULT_RULES,
  buildPass,
  claimKey,
  levelOf,
  seasonAt,
  type CosmeticKind,
  type PassBoard,
  type PassClaimError,
  type PassPrice,
  type Reward,
  type Track,
  type XpResult,
} from './core.ts';
import { tg } from '../telegram.ts';

/** fired after a change the rest of the app should show (worn cosmetics, boosters) */
export const PASS_EVENT = 'dameo:pass';
const changed = () => {
  try {
    window.dispatchEvent(new Event(PASS_EVENT));
  } catch {
    /* not in a browser */
  }
};

export interface Owned {
  id: string;
  kind: CosmeticKind;
  season: number;
  /** UTC ms; null = forever */
  until: number | null;
}
export interface Perk {
  id: string;
  amount: number;
  until: number;
}
export interface StoredBooster {
  id: string;
  pct: number;
  hours: number;
  expires: number;
  label_uz: string;
  label_en: string;
}
export type { PassBoard, Track, Reward, CosmeticKind };
export type Worn = Partial<Record<CosmeticKind, string>>;
export type PassState = PassBoard & {
  balance: number;
  owned: Owned[];
  equipped: Worn;
  perks: Perk[];
  /** beta showcase switch: always false here */
  allOpen: boolean;
  test: boolean;
};

/** a pass_rewards row as the server sends it */
interface ServerReward {
  level: number;
  track: Track;
  kind: Reward['kind'];
  value: string;
  fallback_coins: number;
  rarity: Reward['rarity'];
  label_uz: string;
  label_en: string;
  art: string | null;
  days: number;
  hours: number;
  keep_days: number;
  min_coins: number;
  max_coins: number;
  amount: number;
  pool: string | null;
  note_uz: string | null;
  note_en: string | null;
}
export const fromServerReward = (r: ServerReward): Reward => ({
  level: r.level,
  track: r.track,
  kind: r.kind,
  value: r.value,
  fallbackCoins: r.fallback_coins,
  rarity: r.rarity,
  label_uz: r.label_uz,
  label_en: r.label_en,
  art: r.art ?? undefined,
  days: r.days || undefined,
  hours: r.hours || undefined,
  keepDays: r.keep_days || undefined,
  min: r.min_coins || undefined,
  max: r.max_coins || undefined,
  amount: r.amount || undefined,
  pool: r.pool ?? undefined,
  note_uz: r.note_uz ?? undefined,
  note_en: r.note_en ?? undefined,
});

interface ServerPass {
  season: number;
  season_start: number;
  season_end: number;
  xp: number;
  today: XpResult;
  boost_today: number;
  elite: boolean;
  price: PassPrice;
  checked_in: boolean;
  claims: string[];
  owned: Owned[];
  equipped: Worn;
  balance: number;
  rewards: ServerReward[];
  perks: Perk[];
}

export async function getPass(): Promise<PassState> {
  const r = await db.rpc<ServerPass>('pass_me');
  const now = Date.now();
  const done = new Set(r.claims);
  const lv = levelOf(r.xp);
  // rewards come from the server (pass_rewards); XP, level and claims were decided there too
  const rows = r.rewards?.length ? r.rewards.map(fromServerReward) : DEFAULT_REWARDS;
  const local = seasonAt(now);
  const season = { ...local, n: r.season, start: r.season_start ?? local.start, end: r.season_end ?? local.end };
  const b = buildPass(season, { games: [], checkins: [], missions: {}, missionBonus: [], referrals: [] }, DEFAULT_RULES, rows, r.claims, r.elite, r.price, now);
  const rewards = b.rewards.map((x) => ({
    ...x,
    state: (done.has(claimKey(x.level, x.track)) ? 'claimed' : x.level > lv.level ? 'locked' : x.track === 'elite' && !r.elite ? 'elite_locked' : 'ready') as (typeof b.rewards)[number]['state'],
  }));
  return {
    ...b,
    xp: r.xp,
    earned: r.xp,
    level: lv,
    today: r.today,
    boostToday: r.boost_today,
    checkedInToday: r.checked_in,
    rewards,
    readyCount: rewards.filter((x) => x.state === 'ready').length,
    balance: r.balance,
    owned: r.owned,
    equipped: r.equipped,
    perks: r.perks ?? [],
    allOpen: false,
    test: false,
  };
}

export async function passCheckin(): Promise<boolean> {
  const r = await db.rpc<{ ok: boolean }>('pass_checkin');
  return r.ok;
}

export type PassClaimResult =
  | { ok: true; coins: number; item: string | null; itemName: { uz: string; en: string } | null; cosmetic: CosmeticKind | null; boost: number; balance: number }
  | { ok: false; error: PassClaimError | 'failed' };
export async function claimPass(level: number, track: Track): Promise<PassClaimResult> {
  try {
    const r = await db.rpc<{
      ok: boolean;
      coins?: number;
      item?: string | null;
      item_name_uz?: string | null;
      item_name_en?: string | null;
      cosmetic?: CosmeticKind | null;
      boost?: number;
      balance?: number;
      error?: string;
    }>('pass_claim', { p_level: level, p_track: track });
    if (r.ok) {
      if (r.cosmetic) changed();
      return {
        ok: true,
        coins: r.coins ?? 0,
        item: r.item ?? null,
        itemName: r.item ? { uz: r.item_name_uz ?? r.item, en: r.item_name_en ?? r.item } : null,
        cosmetic: r.cosmetic ?? null,
        boost: r.boost ?? 0,
        balance: r.balance ?? 0,
      };
    }
    const e = r.error === 'unknown' || r.error === 'locked' || r.error === 'elite' || r.error === 'already' ? r.error : 'failed';
    return { ok: false, error: e };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/**
 * Premium Pass with Telegram Stars: the server creates an order and an XTR invoice (Edge Function `payments`,
 * action 'pass_premium'); Telegram shows the payment sheet; Premium opens ONLY when the bot receives
 * `successful_payment` (pass_payment_complete). The app then waits until the server reports Premium.
 */
export type BuyEliteResult = { ok: true; test: boolean } | { ok: false; error: 'already' | 'cancelled' | 'pending' | 'failed' | 'no_telegram' };
export async function buyElite(lang: 'uz' | 'en' = 'uz'): Promise<BuyEliteResult> {
  if (!tg?.openInvoice) return { ok: false, error: 'no_telegram' };
  const inv = await db.invokeFunction<{ ok: boolean; link?: string; error?: string }>('payments', { action: 'pass_premium', lang }).catch(() => null);
  if (!inv?.ok || !inv.link) return { ok: false, error: inv?.error === 'already' ? 'already' : 'failed' };
  const status = await new Promise<string>((res) => tg!.openInvoice!(inv.link!, (st) => res(st)));
  if (status === 'cancelled') return { ok: false, error: 'cancelled' };
  if (status === 'failed') return { ok: false, error: 'failed' };
  // paid (or pending): Premium opens when the server has confirmed the payment
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const me = await db.rpc<{ elite: boolean }>('pass_me').catch(() => null);
    if (me?.elite) return { ok: true, test: false };
  }
  return { ok: false, error: 'pending' };
}

export async function equipCosmetic(kind: CosmeticKind, id: string | null): Promise<boolean> {
  const r = await db.rpc<{ ok: boolean }>('pass_equip', { p_kind: kind, p_id: id });
  if (r.ok) changed();
  return r.ok;
}

/** Worn cosmetics of a player (shown on their profile, next to their name, in their games). Cached briefly. */
const wornCache = new Map<string, { at: number; p: Promise<Worn> }>();
export async function wornOf(userId: string | null | undefined, fresh = false): Promise<Worn> {
  if (!userId) return {};
  const hit = wornCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = db.rpc<Worn>('pass_worn', { p_user: userId }).catch(() => ({}) as Worn);
  wornCache.set(userId, { at: Date.now(), p });
  return p;
}
if (typeof window !== 'undefined') window.addEventListener(PASS_EVENT, () => wornCache.clear());

/* ---------------------------------------------------------------- XP boosters kept in the inventory */
export type BoosterState = { stored: StoredBooster[]; active: { pct: number; from: number; until: number } | null };
export async function getBoosters(): Promise<BoosterState> {
  return db.rpc<BoosterState>('pass_boosters', {});
}
export type ActivateBoosterResult = { ok: true; until: number } | { ok: false; error: 'not_found' | 'expired' | 'active' | 'failed' };
/** Turns a stored booster on now (runs for its hours). */
export async function activateBooster(id: string): Promise<ActivateBoosterResult> {
  try {
    const r = await db.rpc<ActivateBoosterResult>('pass_booster_use', { p_id: Number(id) });
    if (r.ok) changed();
    return r;
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Admin: Premium for this season, free (rpc pass_grant_premium checks the admin role and writes the audit log). */
export async function adminGrantPremium(userId: string, note: string | null = null): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  try {
    const r = await db.rpc<{ ok: boolean; already?: boolean; error?: string }>('pass_grant_premium', { p_user: userId, p_note: note });
    return { ok: !!r.ok, already: !!r.already, error: r.error };
  } catch {
    return { ok: false };
  }
}
