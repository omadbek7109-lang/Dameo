// Edge Function `gifts` (Deno): Telegram Gifts bought with DAMEO Coins (migration 0033).
//  - "buy"     {gift, key, initData?}: signed-in player buys a gift. The Telegram @username is taken only from the
//              Telegram-signed initData (HMAC with the bot token) and only if it belongs to this account's Telegram id.
//              Price, coins, the 4-digit code and the order are all handled in SQL (gift_order_create), atomically.
//  - "confirm" {order_id}: admin ("shop.manage", checked in SQL with the caller's own session) marks the order as
//              delivered exactly once; then the DAMEO bot tells the buyer.
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
    return json(data);
  }

  if (body?.action === 'confirm') {
    const id = Number(body.order_id);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, reason: 'bad-request' }, 400);
    const { data, error } = await user.rpc('admin_gift_confirm', { p_order: id });
    if (error) return json({ ok: false, reason: /forbidden|not authenticated/.test(error.message) ? 'forbidden' : /not found/.test(error.message) ? 'not-found' : 'server' }, /forbidden/.test(error.message) ? 403 : 200);
    if (!data?.ok) return json(data);
    // tell the buyer through the bot
    const text =
      `🎁 <b>Sovg'angiz yuborildi!</b>\n\n` +
      `${GIFT_NAME[data.gift] ?? 'Sovg‘a'} Telegram akkauntingizga yuborildi.\n` +
      `Buyurtma kodi: <b>${data.code}</b>\n\n` +
      `DAMEO'da o'ynaganingiz uchun rahmat! ♟`;
    let notified = false;
    let notifyError = '';
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(data.tg_id), text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "♟ O'yinni ochish", web_app: { url: WEBAPP_URL } }]] } }),
      });
      const t = await r.json();
      notified = !!t.ok;
      notifyError = t.ok ? '' : String(t.description ?? `error ${t.error_code}`);
    } catch (e) {
      notifyError = `network: ${(e as Error).message}`;
    }
    await service.rpc('gift_order_notified', { p_order: id, p_ok: notified, p_error: notifyError });
    return json({ ...data, notified, notify_error: notifyError || null });
  }

  return json({ ok: false, reason: 'unknown-action' }, 400);
});
