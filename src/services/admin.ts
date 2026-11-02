/**
 * Admin API. Every function here is a server-side SQL function that checks the caller's role itself
 * (super_admin / admin / moderator / support); the panel only hides what the server would refuse anyway.
 */
import type { CoinPackage, ShopItem } from './shop.ts';
import { SUPABASE_URL } from './config.ts';
import { db, storageUpload } from './supabase.ts';

export type Role = 'super_admin' | 'admin' | 'moderator' | 'support';
export interface AdminMe {
  role: Role | null;
  perms: string[];
}
export interface Dashboard {
  users_total: number;
  users_online: number;
  users_today: number;
  games_active: number;
  games_today: number;
  payments_paid: number;
  stars_today: number;
  stars_total: number;
  coins_circulation: number;
  purchases_today: number;
  reports_open: number;
  banned: number;
  live_viewers?: number;
  live_games?: number;
}
export interface AdminUser {
  id: string;
  username: string;
  avatar: string;
  tg_id: number | null;
  rating: number;
  created_at: string;
  last_seen: string;
  banned_until: string | null;
  muted_until: string | null;
  balance: number;
  role: Role | null;
  total: number;
}
export interface Payment {
  id: string;
  user_id: string;
  username: string | null;
  coins: number;
  stars: number;
  status: 'pending' | 'paid' | 'rejected' | 'refunded';
  status_reason: string | null;
  telegram_payment_charge_id: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  total: number;
}
export interface Report {
  id: string;
  kind: string;
  body: string;
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
  admin_note: string | null;
  created_at: string;
  reporter: string | null;
  reporter_id: string | null;
  target: string | null;
  target_user_id: string | null;
  match_id: string | null;
  total: number;
}
export interface AuditRow {
  id: number;
  admin: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  details: unknown;
  created_at: string;
  total: number;
}
export interface WeeklyAdmin {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  finalized_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  participants: number;
  winners: Array<{ rank: number; user_id: string; username: string; tg_id: number | null; delta: number; games: number; prize_status: string | null }>;
}
export interface Prize {
  place: number;
  title_uz: string;
  title_en: string;
  icon: string;
}

export const adminMe = () => db.rpc<AdminMe>('admin_me');
export const adminDashboard = () => db.rpc<Dashboard>('admin_dashboard');
export const adminUsers = (q: string, offset = 0) => db.rpc<AdminUser[]>('admin_users', { p_query: q, p_limit: 30, p_offset: offset });
export const adminUserDetail = (id: string) => db.rpc<any>('admin_user_detail', { p_user: id });
export const adminBan = (id: string, until: string, reason: string) => db.rpc('admin_ban', { p_user: id, p_until: until, p_reason: reason });
export const adminUnban = (id: string, reason: string) => db.rpc('admin_unban', { p_user: id, p_reason: reason });
export const adminMute = (id: string, until: string | null, reason: string) => db.rpc('admin_mute', { p_user: id, p_until: until, p_reason: reason });
export const adminAdjust = (id: string, amount: number, reason: string, key: string) =>
  db.rpc<{ balance: number }>('admin_wallet_adjust', { p_user: id, p_amount: amount, p_reason: reason, p_key: key });
export const adminPayments = (status: string | null, offset = 0) => db.rpc<Payment[]>('admin_payments', { p_status: status, p_limit: 30, p_offset: offset });
export const adminPaymentReject = (id: string, reason: string) => db.rpc('admin_payment_reject', { p_order: id, p_reason: reason });
/** refund goes through the Edge Function: coins back first (SQL), then Stars back (Telegram), reverted if Telegram refuses */
export const adminRefund = (id: string, reason: string) => db.invokeFunction<{ ok: boolean; error?: string; detail?: string }>('payments', { action: 'refund', order_id: id, reason });
export const adminPackages = () => db.rpc<CoinPackage[]>('admin_packages');
export const adminPackageSave = (p: Partial<CoinPackage>, reason: string) => db.rpc('admin_package_save', { p, p_reason: reason });
export const adminShopItems = () => db.rpc<ShopItem[]>('admin_shop_items');
export const adminShopSave = (p: Partial<ShopItem>, reason: string) => db.rpc('admin_shop_save', { p, p_reason: reason });
export const adminCategories = () => db.rpc<Array<{ id: string; name_uz: string; name_en: string; sort: number; visible: boolean }>>('admin_categories');
export const adminCategorySave = (p: { id: string; name_uz: string; name_en: string; sort: number; visible: boolean }, reason: string) =>
  db.rpc('admin_category_save', { p, p_reason: reason });
export const adminReports = (status: string | null, offset = 0) => db.rpc<Report[]>('admin_reports', { p_status: status, p_limit: 30, p_offset: offset });
export const adminReportUpdate = (id: string, status: string, note: string) => db.rpc('admin_report_update', { p_id: id, p_status: status, p_note: note });
export const adminRoles = () => db.rpc<Array<{ user_id: string; username: string; tg_id: number | null; role: Role | null; granted_at: string; granted_by: string | null }>>('admin_roles_list');
export const adminRoleSet = (id: string, role: Role | null, reason: string) => db.rpc('admin_role_set', { p_user: id, p_role: role, p_reason: reason });
export const adminAudit = (offset = 0, action: string | null = null) => db.rpc<AuditRow[]>('admin_audit', { p_limit: 50, p_offset: offset, p_action: action });
export const adminWeekly = () => db.rpc<WeeklyAdmin[]>('admin_weekly_list', { p_limit: 12 });
export const adminWeeklyConfirm = (id: string, reason: string) => db.rpc('admin_weekly_confirm', { p_tournament: id, p_reason: reason });
export const adminWeeklyDelivered = (id: string, user: string, reason: string) => db.rpc('admin_weekly_delivered', { p_tournament: id, p_user: user, p_reason: reason });
export const adminPrizesSave = (p: Prize[], reason: string) => db.rpc('admin_weekly_prizes_save', { p, p_reason: reason });
export const weeklyPrizes = () => db.select<Prize>('weekly_prizes', { order: 'place.asc' });

/** shop image → public `shop` bucket (only staff with shop.manage may write; enforced by storage policy) */
export async function uploadShopImage(slug: string, file: Blob): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${slug}/${Date.now()}.${ext}`;
  await storageUpload('shop', path, file);
  return `${SUPABASE_URL}/storage/v1/object/public/shop/${path}`;
}
