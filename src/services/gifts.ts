/**
 * Telegram Gifts bought with DAMEO Coins (server: supabase/migrations/0033_gift_orders.sql, edge function `gifts`).
 * The client sends only the gift id and a one-time purchase key; price, coins and the 4-digit code are server-side.
 */
import { db } from './supabase.ts';
import { tg } from './telegram.ts';
import { newKey } from './shop.ts';

export interface GiftItem {
  id: string;
  title_uz: string;
  title_en: string;
  emoji: string;
  image: string | null;
  price: number;
  sort: number;
}
export interface GiftOrder {
  id: number;
  gift: string;
  price: number;
  code: string;
  status: 'pending' | 'delivered';
  username: string | null;
  created_at: string;
  delivered_at: string | null;
}
export type BuyResult =
  | { ok: true; repeat: boolean; order_id: number; code: string; gift: string; price: number; username: string | null; balance: number }
  | { ok: false; reason: 'insufficient' | 'no-telegram' | 'restricted' | 'unknown-gift' | 'sold-out' | 'server' | string };

/** The partner account that hands out gifts to buyers without a Telegram username. */
export const GIFT_SUPPORT = 'Flect_stars';
export const GIFT_SUPPORT_URL = `https://t.me/${GIFT_SUPPORT}`;

export const giftCatalog = () => db.select<GiftItem>('gift_catalog', { order: 'sort.asc' });
export const myGiftOrders = () => db.rpc<GiftOrder[]>('gift_my_orders');
export const newGiftKey = newKey;
/** initData lets the server read the buyer's @username from Telegram-signed data. */
export const buyGift = (gift: string, key: string) => db.invokeFunction<BuyResult>('gifts', { action: 'buy', gift, key, initData: tg?.initData ?? '' });

/* ---------------------------------------------------------------- admin */
export interface AdminGiftOrder {
  id: number;
  code: string;
  gift: string;
  gift_title: string;
  emoji: string;
  image: string | null;
  price: number;
  tg_id: string;
  tg_username: string | null;
  user_id: string;
  player: string;
  avatar: string;
  status: 'pending' | 'delivered';
  created_at: string;
  delivered_at: string | null;
  delivered_by: string | null;
  notified_at: string | null;
  notify_error: string | null;
}
export const adminGiftOrders = (status: 'pending' | 'delivered' | 'all') => db.rpc<AdminGiftOrder[]>('admin_gift_orders', { p_status: status, p_limit: 200 });
export const adminGiftCounts = () => db.rpc<{ pending: number; delivered: number } | null>('admin_gift_counts');
export const adminGiftConfirm = (orderId: number) =>
  db.invokeFunction<{ ok: boolean; reason?: string; notified?: boolean; notify_error?: string | null }>('gifts', { action: 'confirm', order_id: orderId });
