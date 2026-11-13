// Edge Function `gifts` (Deno): Telegram Gifts bought with DAMEO Coins (migration 0033).
//  - "buy"     {gift, key, initData?}: signed-in player buys a gift. The Telegram @username is taken only from the
//              Telegram-signed initData (HMAC with the bot token) and only if it belongs to this account's Telegram id.
//              Price, coins, the 4-digit code and the order are all handled in SQL (gift_order_create), atomically.
//  - "confirm" {order_id}: admin ("shop.manage", checked in SQL with the caller's own session) marks the order as
//              delivered exactly once; then the DAMEO bot tells the buyer and the orders-channel post becomes "✅ Yuborildi".
//  - "channel_test" {chat_id}: admin — sends a test line to the chosen orders channel.
//  - "renotify" {order_id}: admin — re-sends the buyer's "gift sent" message if it failed (Telegram down …).
//  Every Telegram call times out after 8 s and a temporary failure is retried once, so the admin never waits long.
//  Every new order is also posted to the orders channel set in the admin panel (gift_settings, migration 0034).
// The bot token (TELEGRAM_BOT_TOKEN) never leaves the server.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';
const GIFT_NAME: Record<string, string> = { bear: '🧸 Ayiqcha', heart: '💝 Yurak', rose: '🌹 Atirgul', gift_box: "🎁 Sovg'a qutisi" };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = new TextEncoder();
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '.').replace(',', '') : '');
const coinsFmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
type TgRes = { ok: boolean; error_code?: number; description?: string; result?: any };
/** One Telegram call that never hangs: at most 8 s; a temporary failure (5xx, 429, network, timeout) is retried once. */
async function tg(token: string, method: string, body: unknown): Promise<TgRes> {
  const once = async (): Promise<TgRes> => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => ({ ok: false, error_code: r.status, description: r.statusText || `HTTP ${r.status}` }));
      return j as TgRes;
    } catch (e) {
      return { ok: false, description: (e as Error).name === 'TimeoutError' ? 'timeout' : `network: ${(e as Error).message}` };
    }
  };
  const first = await once();
  const temporary = !first.ok && (first.error_code == null || first.error_code >= 500 || first.error_code === 429);
  if (!temporary) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return once();
}
/** The "your gift was sent" message for the buyer. */
const buyerText = (gift: string, code: string) =>
  `🎁 <b>Sovg'angiz yuborildi!</b>\n\n` +
  `${GIFT_NAME[gift] ?? 'Sovg‘a'} Telegram akkauntingizga yuborildi.\n` +
  `Buyurtma kodi: <b>${code}</b>\n\n` +
  `DAMEO'da o'ynaganingiz uchun rahmat! ♟`;

/** The orders-channel post for one order (HTML). */
function orderPost(n: any): string {
  const tgLine = n.tg_username ? `@${esc(n.tg_username)}` : `<i>username yo'q — @Flect_stars ga kod bilan yozadi</i>`;
  const state = n.status === 'delivered' ? `✅ <b>Yuborildi</b> — ${esc(n.delivered_by ?? 'admin')}, ${when(n.delivered_at)}` : '⏳ Kutilmoqda';
  return (
    `🎁 <b>Yangi sovg'a buyurtmasi #${n.id}</b>\n\n` +
    `Sovg'a: ${esc(n.emoji)} <b>${esc(n.gift_title)}</b> — ${coinsFmt(n.price)} coin\n` +
    `Kod: <code>${esc(n.code)}</code>\n` +
    `O'yinchi: <b>${esc(n.player)}</b>\n` +
    `Telegram: ${tgLine}\n` +
    `TG ID: <code>${esc(n.tg_id)}</code> · <a href="tg://user?id=${esc(n.tg_id)}">profil</a>\n` +
    `Vaqt: ${when(n.created_at)}\n\n` +
    `Holat: ${state}`
  );
}

/** The Telegram user from Mini App initData, only if Telegram's signature is valid (≤ 7 days old). */
async function verifiedTgUser(token: string, initData: string): Promise<{ id: number; username?: string } | null> {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), token);
  if (!hash || !safeEqual(hex(await hmac(secret, check)), hash)) return null;
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 86400) return null;
  try {
    const u = JSON.parse(params.get('user') ?? '');
    return u?.id ? u : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ ok: false, error: 'not-configured' }, 503);
  const url = Deno.env.get('SUPABASE_URL')!;
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u, error: authErr } = await user.auth.getUser();
  if (authErr || !u.user) return json({ ok: false, error: 'unauthorized' }, 401);
  const uid = u.user.id;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }

  if (body?.action === 'buy') {
    const gift = String(body.gift ?? '');
    const key = String(body.key ?? '');
    if (!/^[a-z_]{2,20}$/.test(gift) || !/^[A-Za-z0-9-]{8,80}$/.test(key)) return json({ ok: false, reason: 'bad-request' }, 400);
    // username: from Telegram-signed data of THIS account ('' = verified: no username); null = unknown (SQL falls back)
    let username: string | null = null;
    const tgUser = await verifiedTgUser(token, String(body.initData ?? ''));
    if (tgUser) {
      const { data: p } = await service.from('profiles').select('tg_id').eq('id', uid).maybeSingle();
      if (p?.tg_id != null && String(p.tg_id) === String(tgUser.id)) username = tgUser.username ?? '';
    }
    const { data, error } = await service.rpc('gift_order_create', { p_user: uid, p_gift: gift, p_idem: key, p_username: username });
    if (error) return json({ ok: false, reason: /insufficient/.test(error.message) ? 'insufficient' : /exhausted/.test(error.message) ? 'sold-out' : 'server' });
    if (data?.ok) await postToChannel(token, service, Number(data.order_id)); // never blocks or undoes the purchase
    return json(data);
  }

  if (body?.action === 'confirm') {
    const id = Number(body.order_id);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, reason: 'bad-request' }, 400);
    const { data, error } = await user.rpc('admin_gift_confirm', { p_order: id });
    if (error) return json({ ok: false, reason: /forbidden|not authenticated/.test(error.message) ? 'forbidden' : /not found/.test(error.message) ? 'not-found' : 'server' }, /forbidden/.test(error.message) ? 403 : 200);
    if (!data?.ok) return json(data);
    // tell the buyer through the bot
    const t = await tg(token, 'sendMessage', { chat_id: Number(data.tg_id), text: buyerText(data.gift, data.code), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "♟ O'yinni ochish", web_app: { url: WEBAPP_URL } }]] } });
    const notified = t.ok;
    const notifyError = t.ok ? '' : String(t.description ?? `error ${t.error_code}`);
    await service.rpc('gift_order_notified', { p_order: id, p_ok: notified, p_error: notifyError });
    // the orders channel: turn the post into "✅ Yuborildi" (or post it now if it was never posted)
    const { data: n } = await service.rpc('gift_order_notice', { p_order: id });
    if (n?.channel_msg_id && n?.channel_chat_id) {
      await tg(token, 'editMessageText', { chat_id: Number(n.channel_chat_id), message_id: Number(n.channel_msg_id), text: orderPost(n), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } else await postToChannel(token, service, id);
    return json({ ...data, notified, notify_error: notifyError || null });
  }

  // admin: the buyer's "sent" message failed (e.g. Telegram was down) → send it again (only for delivered, not yet notified)
  if (body?.action === 'renotify') {
    const { error } = await user.rpc('admin_gift_channel'); // shop.manage check
    if (error) return json({ ok: false, reason: 'forbidden' }, 403);
    const id = Number(body.order_id);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, reason: 'bad-request' }, 400);
    const { data: n } = await service.rpc('gift_order_notice', { p_order: id });
    if (!n) return json({ ok: false, reason: 'not-found' });
    if (n.status !== 'delivered') return json({ ok: false, reason: 'not-delivered' });
    if (n.notified_at) return json({ ok: true, notified: true, already: true });
    const t = await tg(token, 'sendMessage', { chat_id: Number(n.tg_id), text: buyerText(n.gift, n.code), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "♟ O'yinni ochish", web_app: { url: WEBAPP_URL } }]] } });
    await service.rpc('gift_order_notified', { p_order: id, p_ok: t.ok, p_error: t.ok ? '' : String(t.description ?? `error ${t.error_code}`) });
    return json({ ok: true, notified: t.ok, notify_error: t.ok ? null : t.description ?? 'error' });
  }

  if (body?.action === 'channel_test') {
    const { error } = await user.rpc('admin_gift_channel');
    if (error) return json({ ok: false, reason: 'forbidden' }, 403);
    const chat = String(body.chat_id ?? '');
    if (!/^-?\d{5,20}$/.test(chat)) return json({ ok: false, reason: 'bad-request' }, 400);
    const r = await tg(token, 'sendMessage', { chat_id: Number(chat), text: "✅ <b>DAMEO</b>: sovg'a buyurtmalari shu yerga keladi.", parse_mode: 'HTML' });
    if (!r.ok && (r.error_code === 400 || r.error_code === 403)) await service.rpc('bot_chat_lost', { p_chat: Number(chat) });
    return json({ ok: r.ok, error: r.ok ? null : r.description ?? 'error' });
  }

  return json({ ok: false, reason: 'unknown-action' }, 400);
});

/** Posts a new order to the orders channel once (if a channel is set); a failure never affects the order. */
async function postToChannel(token: string, service: any, orderId: number) {
  try {
    const { data: n } = await service.rpc('gift_order_notice', { p_order: orderId });
    if (!n || !n.target_chat_id || n.channel_msg_id) return;
    const chat = Number(n.target_chat_id);
    const r = await tg(token, 'sendMessage', { chat_id: chat, text: orderPost(n), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    if (r.ok) await service.rpc('gift_order_channel_msg', { p_order: orderId, p_chat: chat, p_msg: r.result.message_id });
    else if (r.error_code === 400 || r.error_code === 403) await service.rpc('bot_chat_lost', { p_chat: chat });
  } catch {
    /* the channel post is best-effort */
  }
}
