// Edge Function `broadcast` (Deno): a super admin sends one message to everyone who uses the bot.
//  - Every action is checked by SQL with the caller's own JWT (admin_broadcast_* → _admin_require('roles.manage')).
//  - "audience": how many people the bot can reach.
//  - "test": sends the message only to the admin's own Telegram chat (to check formatting and the button).
//  - "create": makes the broadcast (SQL freezes the recipient list) → returns its id.
//  - "run": sends the next batch (≈ 25 messages/s, Telegram's limit is 30) for up to ~40 s and returns progress; the
//    admin page calls it again until nothing is left. Each recipient is claimed in SQL before sending and marked after,
//    so nobody gets the same broadcast twice and an interrupted run continues where it stopped.
//  - "cancel": stops a running broadcast.
// The bot token is the Supabase secret TELEGRAM_BOT_TOKEN and never reaches the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(token: string, chat: number, text: string, withButton: boolean) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(withButton ? { reply_markup: { inline_keyboard: [[{ text: "♟ O'yinni ochish", web_app: { url: WEBAPP_URL } }]] } } : {}),
    }),
  });
  return (await r.json()) as { ok: boolean; error_code?: number; description?: string; parameters?: { retry_after?: number } };
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
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }
  const forbidden = (e: { message?: string } | null) => (e && /forbidden|not authenticated/.test(e.message ?? '') ? json({ ok: false, error: 'forbidden' }, 403) : null);

  if (body?.action === 'audience') {
    const { data, error } = await user.rpc('admin_broadcast_audience');
    return forbidden(error) ?? (error ? json({ ok: false, error: 'server' }, 500) : json({ ok: true, ...data }));
  }

  if (body?.action === 'test') {
    const { data, error } = await user.rpc('admin_broadcast_audience');
    if (error) return forbidden(error) ?? json({ ok: false, error: 'server' }, 500);
    const text = String(body.text ?? '');
    if (!text.trim() || text.length > 4000) return json({ ok: false, error: 'bad-text' }, 400);
    if (!data?.my_tg) return json({ ok: false, error: 'no-telegram' }, 400);
    const r = await send(token, Number(data.my_tg), text, body.with_button !== false);
    return r.ok ? json({ ok: true }) : json({ ok: false, error: 'telegram', detail: r.description ?? '' }, 400);
  }

  if (body?.action === 'create') {
    const { data, error } = await user.rpc('admin_broadcast_create', { p_text: String(body.text ?? ''), p_with_button: body.with_button !== false, p_reason: String(body.reason ?? '') });
    if (error) return forbidden(error) ?? json({ ok: false, error: /still sending/.test(error.message) ? 'busy' : /reason/.test(error.message) ? 'reason' : /bad text/.test(error.message) ? 'bad-text' : 'server' }, 400);
    return json({ ok: true, ...data });
  }

  if (body?.action === 'cancel') {
    const { error } = await user.rpc('admin_broadcast_cancel', { p_id: Number(body.id), p_reason: String(body.reason ?? '') });
    return forbidden(error) ?? (error ? json({ ok: false, error: 'server' }, 400) : json({ ok: true }));
  }

  if (body?.action === 'run') {
    const id = Number(body.id);
    const { data: b, error } = await user.rpc('admin_broadcast_get', { p_id: id });   // also the admin check
    if (error) return forbidden(error) ?? json({ ok: false, error: 'server' }, 500);
    if (!b) return json({ ok: false, error: 'not-found' }, 404);
    const started = Date.now();
    while (Date.now() - started < 40_000) {
      const { data: batch, error: e } = await service.rpc('broadcast_claim', { p_id: id, p_n: 25 });
      if (e) return json({ ok: false, error: 'server' }, 500);
      const ids = ((batch ?? []) as Array<{ tg_id: number }>).map((x) => Number(x.tg_id));
      if (ids.length === 0) break;
      const t0 = Date.now();
      for (const chat of ids) {
        let r = await send(token, chat, b.text, b.with_button);
        if (!r.ok && r.error_code === 429) {                                   // flood limit: wait as Telegram asks, retry once
          await sleep(((r.parameters?.retry_after ?? 3) + 1) * 1000);
          r = await send(token, chat, b.text, b.with_button);
        }
        const status = r.ok ? 'sent' : r.error_code === 403 ? 'blocked' : r.error_code === 429 ? 'pending' : 'failed';
        await service.rpc('broadcast_mark', { p_id: id, p_tg: chat, p_status: status, p_error: r.ok ? null : (r.description ?? '') });
      }
      const spent = Date.now() - t0;
      if (spent < 1000) await sleep(1000 - spent);                             // ≤ 25 messages per second
    }
    const { data: now } = await user.rpc('admin_broadcast_get', { p_id: id });
    return json({ ok: true, broadcast: now });
  }

  return json({ ok: false, error: 'bad-action' }, 400);
});
