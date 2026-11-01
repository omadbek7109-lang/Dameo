// DAMEO Edge Function "telegram-auth" — single-file bundle (generated from supabase/functions/telegram-auth).
// supabase/functions/telegram-auth/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
var enc = new TextEncoder;
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
var hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
function safeEqual(a, b) {
  if (a.length !== b.length)
    return false;
  let r = 0;
  for (let i = 0;i < a.length; i++)
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function cleanName(u) {
  const raw = u.username || [u.first_name, u.last_name].filter(Boolean).join("_") || `tg${u.id}`;
  let n = raw.normalize("NFKD").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 16);
  if (n.length < 3)
    n = `tg${String(u.id).slice(-6)}`;
  return n;
}
var botUsername = null;
async function getBotUsername(token) {
  if (!botUsername) {
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
      botUsername = me?.result?.username ?? null;
    } catch {}
  }
  return botUsername;
}
var TG_PHOTO = /^https:\/\/t\.me\/i\/userpic\/[0-9]{1,4}\/[A-Za-z0-9_.=-]{1,200}$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json({ ok: false, error: "method" }, 405);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token)
    return json({ ok: false, error: "bot-token-missing" }, 500);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }
  if (body?.info)
    return json({ ok: true, bot_username: await getBotUsername(token) });
  const initData = String(body?.initData ?? "");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join(`
`);
  const secret = await hmac(enc.encode("WebAppData"), token);
  if (!hash || !safeEqual(hex(await hmac(secret, check)), hash))
    return json({ ok: false, error: "bad-signature" }, 401);
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 86400)
    return json({ ok: false, error: "expired" }, 401);
  let tgUser;
  try {
    tgUser = JSON.parse(params.get("user") ?? "");
  } catch {
    return json({ ok: false, error: "no-user" }, 400);
  }
  if (!tgUser?.id)
    return json({ ok: false, error: "no-user" }, 400);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const email = `tg${tgUser.id}@tg.dameo-app.com`;
  const password = hex(await hmac(enc.encode(serviceKey), `dameo-tg:${tgUser.id}`));
  const { data: existing } = await admin.from("profiles").select("id").eq("tg_id", tgUser.id).maybeSingle();
  if (!existing) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: cleanName(tgUser), tg_id: tgUser.id, first_name: tgUser.first_name ?? null }
    });
    if (error && !/already/i.test(error.message))
      return json({ ok: false, error: "create-failed", detail: error.message }, 500);
    const userId = created?.user?.id;
    if (userId) {
      const patch = { tg_id: tgUser.id };
      if (typeof tgUser.photo_url === "string" && TG_PHOTO.test(tgUser.photo_url))
        patch.avatar = tgUser.photo_url;
      await admin.from("profiles").update(patch).eq("id", userId);
    }
  }
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signed.session)
    return json({ ok: false, error: "signin-failed", detail: signErr?.message }, 500);
  if (existing == null)
    await admin.from("profiles").update({ tg_id: tgUser.id }).eq("id", signed.user.id);
  const s = signed.session;
  return json({
    ok: true,
    bot_username: await getBotUsername(token),
    session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, user: s.user }
  });
});
