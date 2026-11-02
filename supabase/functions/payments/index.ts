// Edge Function `payments` (Deno): DAMEO Coins top-ups with Telegram Stars, and admin refunds.
//  - action "create": a signed-in player picks a package → the server creates a pending order (SQL payment_create) and asks
//    the Bot API for a Stars invoice link (currency XTR). The Mini App opens it with Telegram.WebApp.openInvoice.
//    Coins are credited ONLY when Telegram sends `successful_payment` to the telegram-bot webhook — never from here.
//  - action "refund": an admin with `payments.refund` refunds a paid order. Coins are taken back first (SQL), then the Stars
//    are returned with refundStarPayment; if Telegram refuses, the SQL step is reverted.
// The bot token is the Supabase secret TELEGRAM_BOT_TOKEN and never reaches the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function botApi(token: string, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ ok: false, error: 'payments-not-configured' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData.user) return json({ ok: false, error: 'unauthorized' }, 401);
  const uid = userData.user.id;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }

  if (body?.action === 'create') {
    const pkg = String(body.package_id ?? '');
    if (!/^[a-z0-9_-]{2,32}$/.test(pkg)) return json({ ok: false, error: 'bad-package' }, 400);
    const { data: order, error } = await admin.rpc('payment_create', { p_user: uid, p_package: pkg });
    if (error || !order) {
      const msg = error?.message ?? '';
      return json({ ok: false, error: /restricted/.test(msg) ? 'restricted' : /too many/.test(msg) ? 'too-many' : /not found/.test(msg) ? 'bad-package' : 'server' }, 400);
    }
    const lang = body.lang === 'en' ? 'en' : 'uz';
    const title = `${fmt(order.coins)} DAMEO Coins`;
    const description = lang === 'en' ? `Top up your DAMEO balance with ${fmt(order.coins)} coins 🪙` : `DAMEO balansini ${fmt(order.coins)} tangaga to'ldirish 🪙`;
    const link = await botApi(token, 'createInvoiceLink', {
      title,
      description,
      payload: order.order_id,
      currency: 'XTR',
      prices: [{ label: title, amount: order.stars }],
    });
    if (!link?.ok) return json({ ok: false, error: 'telegram', detail: link?.description ?? null }, 502);
    return json({ ok: true, order_id: order.order_id, link: link.result, stars: order.stars, coins: order.coins });
  }

  if (body?.action === 'refund') {
    const orderId = String(body.order_id ?? '');
    const reason = String(body.reason ?? '').trim();
    if (!/^[0-9a-f-]{36}$/.test(orderId)) return json({ ok: false, error: 'bad-order' }, 400);
    // step 1: permission + coins back + order refunded (all in one SQL transaction)
    const { data: info, error } = await admin.rpc('payment_refund_begin', { p_order: orderId, p_admin: uid, p_reason: reason });
    if (error || !info) {
      const msg = error?.message ?? '';
      return json({ ok: false, error: /forbidden/.test(msg) ? 'forbidden' : /insufficient/.test(msg) ? 'coins-spent' : /reason/.test(msg) ? 'reason' : msg || 'server' }, 400);
    }
    // step 2: return the Stars through Telegram
    const r = await botApi(token, 'refundStarPayment', { user_id: info.tg_user_id, telegram_payment_charge_id: info.charge_id });
    if (!r?.ok) {
      await admin.rpc('payment_refund_revert', { p_order: orderId, p_admin: uid, p_error: r?.description ?? 'telegram error' });
      return json({ ok: false, error: 'telegram', detail: r?.description ?? null }, 502);
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: 'bad-request' }, 400);
});
