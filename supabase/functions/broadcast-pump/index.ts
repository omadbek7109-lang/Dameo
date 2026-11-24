// Edge Function `broadcast-pump` (Deno): a worker that only CONTINUES broadcasts already created in the database
// (status 'sending', created in the last 6 hours, recipient list frozen in broadcast_deliveries). It cannot create a
// broadcast or change its text, so it needs no user JWT (like `daily-winner`, it is woken by pg_net). Each recipient is
// claimed in SQL before sending and marked after (broadcast_claim / broadcast_mark), so nobody gets a message twice.
// 5 messages per second, so recipients open the app gradually (Nano server). The bot token stays a Supabase secret.
// Deployed with verify_jwt = false.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type TgResult = { ok: boolean; error_code?: number; description?: string; parameters?: { retry_after?: number } };

async function tg(token: string, body: unknown): Promise<TgResult> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()) as TgResult;
  } catch (e) {
    return { ok: false, description: `network: ${(e as Error).message}` };
  }
}
// green "open the game" button; older Telegram apps reject `style` → resend without it
async function send(token: string, chat: number, text: string, withButton: boolean) {
  const base = { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (!withButton) return tg(token, base);
  const button = { text: "♟ O'yinni ochish", web_app: { url: WEBAPP_URL } };
  let r = await tg(token, { ...base, reply_markup: { inline_keyboard: [[{ ...button, style: 'success' }]] } });
  if (!r.ok && r.error_code === 400 && !/chat not found/i.test(r.description ?? '')) r = await tg(token, { ...base, reply_markup: { inline_keyboard: [[button]] } });
  return r;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ ok: false, error: 'not-configured' }, 503);
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: list, error } = await service.from('broadcasts').select('id, text, with_button').eq('status', 'sending').gt('created_at', since).order('id', { ascending: true }).limit(1);
  if (error) return json({ ok: false, error: 'server' }, 500);
  const b = list?.[0];
  if (!b) return json({ ok: true, idle: true });
  const started = Date.now();
  let sent = 0;
  while (Date.now() - started < 40_000) {
    const { data: batch, error: e } = await service.rpc('broadcast_claim', { p_id: b.id, p_n: 5 }); // 5 a second: people open the app gradually (server load)
    if (e) return json({ ok: false, error: 'server' }, 500);
    const ids = ((batch ?? []) as Array<{ tg_id: number }>).map((x) => Number(x.tg_id));
    if (ids.length === 0) break;
    const t0 = Date.now();
    for (const chat of ids) {
      let r = await send(token, chat, b.text, b.with_button);
      if (!r.ok && r.error_code === 429) {
        await sleep(((r.parameters?.retry_after ?? 3) + 1) * 1000);
        r = await send(token, chat, b.text, b.with_button);
      }
      const status = r.ok ? 'sent' : r.error_code === 403 ? 'blocked' : r.error_code === 429 ? 'pending' : 'failed';
      if (r.ok) sent++;
      await service.rpc('broadcast_mark', { p_id: b.id, p_tg: chat, p_status: status, p_error: r.ok ? null : (r.description ?? '') });
    }
    const spent = Date.now() - t0;
    if (spent < 1000) await sleep(1000 - spent);
  }
  return json({ ok: true, id: b.id, sent });
});
