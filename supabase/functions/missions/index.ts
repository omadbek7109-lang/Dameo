// Edge Function `missions` (Deno): Telegram channel missions (migration 0032).
//  - "check"  {channel_id}: asks Telegram (getChatMember) whether the signed-in player is in the channel and records it.
//  - "claim"  {channel_id}: the "Olish" button — checks membership again right now and, only if Telegram confirms it,
//              pays the channel's reward through SQL (mission_channel_claim: once per account and per Telegram account).
//  - "probe"  {chat, channel_id?}: admin only ("missions.manage") — resolves the channel (title, @username, invite link)
//              and checks that the bot is an administrator there, so membership can be verified.
// The amount always comes from the database, never from the request. The bot token (TELEGRAM_BOT_TOKEN) stays here.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type TgResult = { ok: boolean; error_code?: number; description?: string; result?: any };
async function tg(token: string, method: string, body: unknown): Promise<TgResult> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()) as TgResult;
  } catch (e) {
    return { ok: false, description: `network: ${(e as Error).message}` };
  }
}

/** member | not_member | unavailable (bot cannot see the channel's members) | error (temporary) */
async function membership(token: string, chat: string, tgId: number): Promise<{ state: 'member' | 'not_member' | 'unavailable' | 'error'; status: string }> {
  const r = await tg(token, 'getChatMember', { chat_id: chat, user_id: tgId });
  if (r.ok) {
    const st = String(r.result?.status ?? '');
    const member = st === 'member' || st === 'administrator' || st === 'creator' || (st === 'restricted' && r.result?.is_member === true);
    return { state: member ? 'member' : 'not_member', status: st };
  }
  // the user has never been in the chat
  if (/user not found|PARTICIPANT_ID_INVALID|USER_NOT_PARTICIPANT/i.test(r.description ?? '')) return { state: 'not_member', status: 'left' };
  if (r.error_code === 400 || r.error_code === 403) return { state: 'unavailable', status: (r.description ?? '').slice(0, 120) };
  return { state: 'error', status: (r.description ?? 'error').slice(0, 120) };
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

  /* ---------------------------------------------------------------- player */
  if (body?.action === 'check' || body?.action === 'claim') {
    const channel = Number(body.channel_id);
    if (!Number.isSafeInteger(channel) || channel <= 0) return json({ ok: false, error: 'bad-channel' }, 400);
    const { data: t, error } = await service.rpc('mission_channel_target', { p_user: uid, p_channel: channel });
    if (error) return json({ ok: false, error: 'server' }, 500);
    if (!t || !t.active) return json({ ok: true, state: 'inactive' });
    if (t.claimed) return json({ ok: true, state: 'claimed' });
    if (!t.tg_id) return json({ ok: true, state: 'no-telegram' });
    const m = await membership(token, String(t.chat_id), Number(t.tg_id));
    if (m.state === 'member' || m.state === 'not_member') {
      await service.rpc('mission_channel_verified', { p_user: uid, p_channel: channel, p_member: m.state === 'member', p_status: m.status });
    }
    if (m.state !== 'member' || body.action === 'check') return json({ ok: true, state: m.state, reward: t.reward });
    const { data: c, error: cErr } = await service.rpc('mission_channel_claim', { p_user: uid, p_channel: channel });
    if (cErr) return json({ ok: false, error: 'server' }, 500);
    return json(c?.ok ? { ok: true, state: 'claimed', coins: c.coins, balance: c.balance } : { ok: true, state: c?.reason === 'claimed' ? 'claimed' : 'error', reason: c?.reason });
  }

  /* ---------------------------------------------------------------- admin */
  if (body?.action === 'probe') {
    const { data: me } = await user.rpc('admin_me');
    if (!Array.isArray(me?.perms) || !me.perms.includes('missions.manage')) return json({ ok: false, error: 'forbidden' }, 403);
    let chat = String(body.chat ?? '').trim().replace(/^https?:\/\/t\.me\//i, '');
    if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(chat)) chat = '@' + chat;
    if (!/^(@[A-Za-z0-9_]{4,32}|-?\d{5,20})$/.test(chat)) return json({ ok: true, found: false, error: 'bad-chat' });
    const c = await tg(token, 'getChat', { chat_id: chat });
    if (!c.ok) return json({ ok: true, found: false, error: (c.description ?? '').slice(0, 160) });
    const meBot = await tg(token, 'getMe', {});
    const bm = meBot.ok ? await tg(token, 'getChatMember', { chat_id: c.result.id, user_id: meBot.result.id }) : { ok: false } as TgResult;
    const status = bm.ok ? String(bm.result?.status ?? '') : (bm.description ?? 'not a member');
    const botAdmin = bm.ok && (status === 'administrator' || status === 'creator');
    const res = {
      ok: true,
      found: true,
      chat_id: c.result.username ? `@${c.result.username}` : String(c.result.id),
      numeric_id: String(c.result.id),
      title: c.result.title ?? c.result.username ?? String(c.result.id),
      username: c.result.username ?? null,
      invite_link: c.result.invite_link ?? null,
      type: c.result.type,
      bot_admin: botAdmin,
      bot_status: status.slice(0, 120),
    };
    const id = Number(body.channel_id);
    if (Number.isSafeInteger(id) && id > 0) await service.rpc('mission_channel_bot_status', { p_channel: id, p_ok: botAdmin, p_status: res.bot_status });
    return json(res);
  }

  return json({ ok: false, error: 'unknown-action' }, 400);
});
