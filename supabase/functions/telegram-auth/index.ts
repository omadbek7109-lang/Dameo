// Edge Function `telegram-auth` (Deno): signs a Telegram Mini App user into Supabase Auth.
// 1. Verifies Telegram's initData signature with TELEGRAM_BOT_TOKEN (Supabase secret, never sent to browsers).
// 2. Creates the Supabase user on first visit (no e-mail is sent; the address is internal).
// 3. Signs in with a per-user password derived from the service key, and returns the session.
// 4. Referral: when the Mini App was opened with https://t.me/<bot>?startapp=ref_<CODE>, Telegram puts start_param into
//    the SIGNED initData — so the code is taken only from there, after the signature check, and linked by SQL
//    (referral_attach decides: new player only, no self-referral, one inviter). `{ referral: true }` links without
//    signing in (for a player who already has a session).
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

function cleanName(u: { username?: string; first_name?: string; last_name?: string; id: number }) {
  const raw = u.username || [u.first_name, u.last_name].filter(Boolean).join('_') || `tg${u.id}`;
  let n = raw.normalize('NFKD').replace(/[^A-Za-z0-9_.]/g, '').slice(0, 16);
  if (n.length < 3) n = `tg${String(u.id).slice(-6)}`;
  return n;
}

let botUsername: string | null = null;
async function getBotUsername(token: string) {
  if (!botUsername) {
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
      botUsername = me?.result?.username ?? null;
    } catch {
      /* optional */
    }
  }
  return botUsername;
}
const TG_PHOTO = /^https:\/\/t\.me\/i\/userpic\/[0-9]{1,4}\/[A-Za-z0-9_.=-]{1,200}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ ok: false, error: 'bot-token-missing' }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }
  // Public info for the website's "Open in Telegram" button.
  if (body?.info) return json({ ok: true, bot_username: await getBotUsername(token) });
  const initData = String(body?.initData ?? '');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), token);
  if (!hash || !safeEqual(hex(await hmac(secret, check)), hash)) return json({ ok: false, error: 'bad-signature' }, 401);
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 86400) return json({ ok: false, error: 'expired' }, 401);

  let tgUser: any;
  try {
    tgUser = JSON.parse(params.get('user') ?? '');
  } catch {
    return json({ ok: false, error: 'no-user' }, 400);
  }
  if (!tgUser?.id) return json({ ok: false, error: 'no-user' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const refCode = /^ref_([A-Za-z2-9]{8})$/.exec(params.get('start_param') ?? '')?.[1] ?? null;
  const attach = async (userId: string): Promise<string | null> => {
    if (!refCode) return null;
    const { data, error } = await admin.rpc('referral_attach', { p_invitee: userId, p_code: refCode });
    return error ? 'error' : (data as string);
  };
  if (body?.referral === true) {
    const { data: p } = await admin.from('profiles').select('id').eq('tg_id', tgUser.id).maybeSingle();
    if (!p) return json({ ok: false, error: 'no-account' }, 404);
    return json({ ok: true, referral: (await attach(p.id)) ?? 'no-code' });
  }
  const email = `tg${tgUser.id}@tg.dameo-app.com`;
  const password = hex(await hmac(enc.encode(serviceKey), `dameo-tg:${tgUser.id}`));

  const { data: existing } = await admin.from('profiles').select('id').eq('tg_id', tgUser.id).maybeSingle();
  if (!existing) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: cleanName(tgUser), tg_id: tgUser.id, first_name: tgUser.first_name ?? null },
    });
    if (error && !/already/i.test(error.message)) return json({ ok: false, error: 'create-failed', detail: error.message }, 500);
    const userId = created?.user?.id;
    if (userId) {
      // first visit: Telegram photo becomes the default avatar (players can change it later)
      const patch: Record<string, unknown> = { tg_id: tgUser.id };
      if (typeof tgUser.photo_url === 'string' && TG_PHOTO.test(tgUser.photo_url)) patch.avatar = tgUser.photo_url;
      await admin.from('profiles').update(patch).eq('id', userId);
    }
  }

  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signed.session) return json({ ok: false, error: 'signin-failed', detail: signErr?.message }, 500);
  if (existing == null) await admin.from('profiles').update({ tg_id: tgUser.id }).eq('id', signed.user!.id);

  const s = signed.session;
  const referral = await attach(signed.user!.id);
  return json({
    ok: true,
    referral,
    bot_username: await getBotUsername(token),
    session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, user: s.user },
  });
});
