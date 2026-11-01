// Edge Function `telegram-bot` (Deno): the bot's chat side.
//  - POST from Telegram (webhook): answers /start (and /play, /help) with a welcome text + "open the game" button.
//  - GET ?setup=1: registers this function as the bot's webhook (with a secret header), sets the menu button
//    and the command list. Safe to call repeatedly; it only points the bot at this same function.
// Deploy with verify_jwt = false (Telegram does not send a Supabase JWT); requests are authenticated
// with Telegram's X-Telegram-Bot-Api-Secret-Token header instead.
const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';

const enc = new TextEncoder();
async function webhookSecret(token: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('dameo-webhook')));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tg(token: string, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function welcome(lang: string | undefined, name: string) {
  if (lang?.startsWith('en')) {
    return (
      `♟ <b>DAMEO</b> — online checkers\n\n` +
      `Hi, ${name}! Play friends or the bot, climb the leaderboard and reach Level 10 🏆\n\n` +
      `Tap the button below to start 👇\n\n` +
      `━━━━━━━━━━━━\n` +
      `Cheap Premium and Stars: @Flect_starsBot ✨`
    );
  }
  return (
    `♟ <b>DAMEO</b> — onlayn shashka\n\n` +
    `Salom, ${name}! Do'stlaring yoki bot bilan o'yna, reytingda ko'taril va Level 10 ga yet 🏆\n\n` +
    `O'yinni boshlash uchun pastdagi tugmani bosing 👇\n\n` +
    `━━━━━━━━━━━━\n` +
    `Arzon Premium va Stars olish uchun @Flect_starsBot ✨`
  );
}
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

Deno.serve(async (req) => {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return new Response('TELEGRAM_BOT_TOKEN missing', { status: 500 });
  const secret = await webhookSecret(token);
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('setup') === '1') {
    const self = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`;
    const me = await tg(token, 'getMe', {});
    const info = await tg(token, 'getWebhookInfo', {});
    const current: string = info?.result?.url ?? '';
    // Never silently take over a bot that is already served by another backend.
    if (current && current !== self && url.searchParams.get('force') !== '1') {
      return Response.json({ ok: false, error: 'bot-has-other-webhook', bot: me?.result?.username, current_webhook_host: new URL(current).host });
    }
    const results = {
      bot: me?.result?.username,
      previous_webhook: current || null,
      webhook: await tg(token, 'setWebhook', { url: self, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false }),
      menu: await tg(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: "O'ynash", web_app: { url: WEBAPP_URL } } }),
      commands: await tg(token, 'setMyCommands', { commands: [{ command: 'start', description: "DAMEO — o'yinni ochish" }] }),
      commands_en: await tg(token, 'setMyCommands', { commands: [{ command: 'start', description: 'DAMEO — open the game' }], language_code: 'en' }),
    };
    return Response.json(results);
  }

  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 });

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response('ok');
  }
  const msg = update?.message;
  const text: string = msg?.text ?? '';
  if (msg?.chat?.type === 'private' && /^\/(start|play|help)\b/.test(text)) {
    const from = msg.from ?? {};
    const name = escapeHtml(from.first_name || from.username || "o'yinchi");
    const lang: string | undefined = from.language_code;
    // "/start join_ABC123" (deep link) opens the game straight into that room
    const param = text.split(' ')[1] ?? '';
    const appUrl = /^join_[A-Z0-9]{4,8}$/i.test(param) ? `${WEBAPP_URL}#/play?mode=friends&join=${param.slice(5).toUpperCase()}` : WEBAPP_URL;
    await tg(token, 'sendMessage', {
      chat_id: msg.chat.id,
      text: welcome(lang, name),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: lang?.startsWith('en') ? '♟ Play now' : "♟ O'yinni boshlash", web_app: { url: appUrl } }]] },
    });
  }
  return new Response('ok'); // always 200 so Telegram does not retry
});
