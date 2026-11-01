// DAMEO Edge Function "telegram-bot" — single-file bundle (source: supabase/functions/telegram-bot). Deploy with verify_jwt OFF.
// supabase/functions/telegram-bot/index.ts
var WEBAPP_URL = Deno.env.get("DAMEO_WEBAPP_URL") ?? "https://omadbek7109-lang.github.io/Dameo/";
var enc = new TextEncoder;
async function webhookSecret(token) {
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("dameo-webhook")));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}
function welcome(lang, name) {
  if (lang?.startsWith("en")) {
    return `♟ <b>DAMEO</b> — online checkers

` + `Hi, ${name}! Play friends or the bot, climb the leaderboard and reach Level 10 \uD83C\uDFC6

` + `Tap the button below to start \uD83D\uDC47

` + `━━━━━━━━━━━━
` + `Cheap Premium and Stars: @Flect_starsBot ✨`;
  }
  return `♟ <b>DAMEO</b> — onlayn shashka

` + `Salom, ${name}! Do'stlaring yoki bot bilan o'yna, reytingda ko'taril va Level 10 ga yet \uD83C\uDFC6

` + `O'yinni boshlash uchun pastdagi tugmani bosing \uD83D\uDC47

` + `━━━━━━━━━━━━
` + `Arzon Premium va Stars olish uchun @Flect_starsBot ✨`;
}
var escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
Deno.serve(async (req) => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token)
    return new Response("TELEGRAM_BOT_TOKEN missing", { status: 500 });
  const secret = await webhookSecret(token);
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("setup") === "1") {
    const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-bot`;
    const me = await tg(token, "getMe", {});
    const info = await tg(token, "getWebhookInfo", {});
    const current = info?.result?.url ?? "";
    if (current && current !== self && url.searchParams.get("force") !== "1") {
      return Response.json({ ok: false, error: "bot-has-other-webhook", bot: me?.result?.username, current_webhook_host: new URL(current).host });
    }
    const results = {
      bot: me?.result?.username,
      previous_webhook: current || null,
      webhook: await tg(token, "setWebhook", { url: self, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false }),
      menu: await tg(token, "setChatMenuButton", { menu_button: { type: "web_app", text: "O'ynash", web_app: { url: WEBAPP_URL } } }),
      commands: await tg(token, "setMyCommands", { commands: [{ command: "start", description: "DAMEO — o'yinni ochish" }] }),
      commands_en: await tg(token, "setMyCommands", { commands: [{ command: "start", description: "DAMEO — open the game" }], language_code: "en" })
    };
    return Response.json(results);
  }
  if (req.method !== "POST")
    return new Response("ok");
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret)
    return new Response("forbidden", { status: 403 });
  let update;
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }
  const msg = update?.message;
  const text = msg?.text ?? "";
  if (msg?.chat?.type === "private" && /^\/(start|play|help)\b/.test(text)) {
    const from = msg.from ?? {};
    const name = escapeHtml(from.first_name || from.username || "o'yinchi");
    const lang = from.language_code;
    const param = text.split(" ")[1] ?? "";
    const appUrl = /^join_[A-Z0-9]{4,8}$/i.test(param) ? `${WEBAPP_URL}#/play?mode=friends&join=${param.slice(5).toUpperCase()}` : WEBAPP_URL;
    await tg(token, "sendMessage", {
      chat_id: msg.chat.id,
      text: welcome(lang, name),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: lang?.startsWith("en") ? "♟ Play now" : "♟ O'yinni boshlash", web_app: { url: appUrl } }]] }
    });
  }
  return new Response("ok");
});
