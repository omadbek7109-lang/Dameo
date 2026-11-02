/**
 * DAMEO Coins, Shop, Inventory and Stars top-ups (server: migrations 0011/0012, Edge Function `payments`).
 * Every write is a server function: the browser never sets a balance, an owner or a price.
 */
import type { Slot } from './skins.ts';
import { db } from './supabase.ts';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
export interface ShopItem {
  slug: string;
  category_id: string;
  slot: Slot;
  collection: string;
  name_uz: string;
  name_en: string;
  desc_uz: string;
  desc_en: string;
  rarity: Rarity;
  price: number;
  final_price: number;
  discount_percent: number;
  is_free: boolean;
  is_default: boolean;
  retired: boolean;
  premium_only: boolean;
  style: unknown;
  image_url: string | null;
  owned: boolean;
  /** admin listing only */
  active?: boolean;
  sort?: number;
}
export interface ShopCategory {
  id: string;
  name_uz: string;
  name_en: string;
}
export interface Equipped {
  piece: string | null;
  board: string | null;
  effect: string | null;
}
export interface Catalog {
  categories: ShopCategory[];
  items: ShopItem[];
  equipped: Equipped | null;
}
export interface CoinPackage {
  id: string;
  coins: number;
  bonus_coins: number;
  stars: number;
  active: boolean;
  sort: number;
}
export interface LedgerRow {
  id: number;
  amount: number;
  balance_after: number;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_at: string;
}
export interface Cosmetic {
  slug: string;
  style: unknown;
}

export const shopCatalog = () => db.rpc<Catalog>('shop_catalog');
/** a fresh idempotency key per purchase attempt (retries of the same attempt reuse it) */
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
export const shopBuy = (slug: string, key: string) => db.rpc<{ ok: boolean; balance: number; duplicate?: boolean }>('shop_buy', { p_slug: slug, p_key: key });
export const equipItem = (slot: Slot, slug: string | null) => db.rpc<{ ok: boolean }>('equip_item', { p_slot: slot, p_slug: slug });
export const cosmeticsOf = (userId: string) => db.rpc<{ piece: Cosmetic | null; board: Cosmetic | null; effect: Cosmetic | null } | null>('cosmetics_of', { p_user: userId });
export const walletMe = () => db.rpc<{ balance: number; updated_at: string | null }>('wallet_me');
export const walletHistory = (before?: number) => db.rpc<LedgerRow[]>('wallet_history', before ? { p_limit: 30, p_before: before } : { p_limit: 30 });
export const coinPackages = () => db.select<CoinPackage>('coin_packages', { order: 'sort.asc' });
export const myPayments = () => db.rpc<Array<{ id: string; coins: number; stars: number; status: string; created_at: string; paid_at: string | null }>>('payments_mine', { p_limit: 20 });
/** asks the server for a Telegram Stars invoice link for a package (coins are credited only after Telegram confirms) */
export const createInvoice = (packageId: string, lang: 'uz' | 'en') =>
  db.invokeFunction<{ ok: boolean; link?: string; order_id?: string; error?: string }>('payments', { action: 'create', package_id: packageId, lang });
export const reportCreate = (kind: string, body: string, target?: string | null, match?: string | null) =>
  db.rpc<{ id: string }>('report_create', { p_kind: kind, p_body: body, p_target: target ?? null, p_match: match ?? null });
export interface ServerNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}
export const myNotifications = () => db.rpc<ServerNotification[]>('notifications_mine', { p_limit: 30 });
export const markNotificationsRead = () => db.rpc('notifications_mark_read');

/** "12 500" — thin-space grouping like the design */
export const coins = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const itemName = (i: Pick<ShopItem, 'name_uz' | 'name_en'>, lang: 'uz' | 'en') => (lang === 'uz' ? i.name_uz : i.name_en);
export const itemDesc = (i: Pick<ShopItem, 'desc_uz' | 'desc_en'>, lang: 'uz' | 'en') => (lang === 'uz' ? i.desc_uz : i.desc_en);
