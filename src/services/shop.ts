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

/* ------------------------------------------------------------------ Limited Board Collection (0020) */
export interface BoardStock {
  slug: string;
  tier: number;
  icon: string;
  /** null = the admin has not set this board's copies limit yet */
  supply: number | null;
  sold: number;
  remaining: number | null;
  sold_out: boolean;
  mine: { serial: number; acquired_at: string } | null;
  name_uz: string;
  name_en: string;
  rarity: Rarity;
  image_url: string | null;
}
export interface CollectionItem {
  id: string;
  slug: string;
  serial: number;
  supply: number | null;
  acquired_at: string;
  tier: number;
  icon: string;
  rarity: Rarity;
  name_uz: string;
  name_en: string;
  image_url: string | null;
  style: unknown;
}
export interface Collection {
  visible: boolean;
  public: boolean;
  mine?: boolean;
  owner: string;
  total: number;
  owned?: number;
  limited?: number;
  complete_pct?: number;
  items?: CollectionItem[];
}
export interface Pricing {
  stars_per_1000: number;
  som_per_coin: number;
}
export const boardStock = () => db.rpc<BoardStock[]>('board_catalog_list');
export const collectionOf = (userId: string) => db.rpc<Collection>('board_collection_of', { p_user: userId });
export const setCollectionPublic = (on: boolean) => db.rpc<{ ok: boolean }>('collection_set_public', { p_public: on });
export const pricingSettings = () => db.select<Pricing>('pricing_settings', { select: 'stars_per_1000,som_per_coin' }).then((r) => r[0] ?? { stars_per_1000: 25, som_per_coin: 10 });
/** "#007/30" — a serial with its edition size (no size while the limit is not set) */
export const serialLabel = (serial: number, supply: number | null) => {
  const w = Math.max(3, String(supply ?? serial).length);
  return `#${String(serial).padStart(w, '0')}${supply ? `/${supply}` : ''}`;
};
/** board artwork: stored as a path relative to the app (boards/<slug>.webp) */
export const boardArt = (url: string | null) => (url ? new URL(url, document.baseURI).href : '');
