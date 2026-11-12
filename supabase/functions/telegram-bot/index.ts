// Edge Function `telegram-bot` (Deno): the bot's chat side.
//  - POST from Telegram (webhook): answers /start (and /play, /help) with a welcome text + "open the game" button,
//    and records the chat in bot_subscribers (for admin broadcasts).
//  - "/start room_<CODE>" (room invitation link t.me/<bot>?start=room_<CODE>): checks that the room exists and is still
//    waiting, then sends one button that opens the Mini App straight into the room (the app joins it automatically).
//  - GET ?setup=1: registers this function as the bot's webhook (with a secret header), sets the menu button
//    and the command list. Safe to call repeatedly; it only points the bot at this same function.
//  - Telegram Stars payments: answers pre_checkout_query (SQL payment_precheck decides) and, on successful_payment,
//    credits the DAMEO Coins exactly once (SQL payment_complete, unique Telegram charge id) and thanks the player.
// Deploy with verify_jwt = false (Telegram does not send a Supabase JWT); requests are authenticated
// with Telegram's X-Telegram-Bot-Api-Secret-Token header instead.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';
const CHANNEL_URL = 'https://t.me/Dameo_channel';

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
      webhook: await tg(token, 'setWebhook', { url: self, secret_token: secret, allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false }),
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
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // ---- Stars: Telegram asks whether this payment may go through (must answer within 10 s)
  const pcq = update?.pre_checkout_query;
  if (pcq?.id) {
    let error: string | null = 'Order not found';
    if (UUID.test(String(pcq.invoice_payload ?? ''))) {
      const { data, error: e } = await db().rpc('payment_precheck', {
        p_order: pcq.invoice_payload, p_stars: pcq.total_amount, p_currency: pcq.currency, p_tg: pcq.from?.id,
      });
      error = e ? 'Server error, please try again' : (data as string | null);
    }
    await tg(token, 'answerPreCheckoutQuery', error ? { pre_checkout_query_id: pcq.id, ok: false, error_message: error } : { pre_checkout_query_id: pcq.id, ok: true });
    return new Response('ok');
  }

  const msg = update?.message;
  const text: string = msg?.text ?? '';

  // ---- Stars: the payment went through → credit the coins (idempotent on the Telegram charge id)
  const paid = msg?.successful_payment;
  if (paid) {
    const { data, error } = await db().rpc('payment_complete', {
      p_order: UUID.test(String(paid.invoice_payload ?? '')) ? paid.invoice_payload : '00000000-0000-0000-0000-000000000000',
      p_charge: paid.telegram_payment_charge_id, p_provider_charge: paid.provider_payment_charge_id ?? null,
      p_stars: paid.total_amount, p_tg: msg.from?.id, p_raw: paid,
    });
    if (error) return new Response('retry', { status: 500 });          // Telegram retries the update later
    const en = msg.from?.language_code?.startsWith('en');
    const r = data as { ok: boolean; duplicate?: boolean; coins?: number; balance?: number };
    if (r?.ok && !r.duplicate) {
      const n = (x: number) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      await tg(token, 'sendMessage', {
        chat_id: msg.chat.id,
        text: en
          ? `✅ Payment received!\n\n🪙 +${n(r.coins ?? 0)} DAMEO Coins\nBalance: ${n(r.balance ?? 0)} 🪙`
          : `✅ To'lov qabul qilindi!\n\n🪙 +${n(r.coins ?? 0)} DAMEO Coins\nBalans: ${n(r.balance ?? 0)} 🪙`,
        reply_markup: { inline_keyboard: [[{ text: en ? '🛍 Open the shop' : "🛍 Do'konni ochish", web_app: { url: `${WEBAPP_URL}#/shop` } }]] },
      });
    } else if (r && !r.ok) {
      await tg(token, 'sendMessage', {
        chat_id: msg.chat.id,
        text: en ? '⚠️ We received your payment but need to check it. Support will contact you.' : "⚠️ To'lov qabul qilindi, lekin tekshiruv kerak. Yordam xizmati siz bilan bog'lanadi.",
      });
    }
    return new Response('ok');
  }
  if (msg?.chat?.type === 'private' && /^\/(start|play|help)\b/.test(text)) {
    const from = msg.from ?? {};
    // remember the chat for admin broadcasts (also un-marks someone who had blocked the bot and came back)
    await db().rpc('bot_subscriber_touch', { p_tg: msg.chat.id, p_first: from.first_name ?? null, p_username: from.username ?? null, p_lang: from.language_code ?? null })
      .then(() => {}, () => {});
    const name = escapeHtml(from.first_name || from.username || "o'yinchi");
    const lang: string | undefined = from.language_code;
    const en = lang?.startsWith('en');

    // "/start room_ABC123" (room invitation): check the room, then one button opens the Mini App straight into it
    const roomCode = /^room_([A-Z0-9]{4,8})$/i.exec(text.split(' ')[1] ?? '')?.[1]?.toUpperCase();
    if (roomCode) {
      const { data: room } = await db().from('matches').select('id, status, white_id, black_id').eq('code', roomCode)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: owner } = room ? await db().from('profiles').select('username, tg_id').eq('id', room.white_id).maybeSingle() : { data: null };
      const open = (hash: string, label: string) => ({ text: label, web_app: { url: `${WEBAPP_URL}${hash}` }, style: 'success' });
      let reply: { text: string; button: Record<string, unknown> };
      if (room?.status === 'waiting' && owner?.tg_id != null && String(owner.tg_id) === String(msg.chat.id)) {
        reply = {
          text: en ? `♟ This is your own room <b>${roomCode}</b>. Waiting for your friend to join…` : `♟ Bu sizning xonangiz: <b>${roomCode}</b>. Do'stingiz qo'shilishini kuting…`,
          button: open('#/play?mode=friends', en ? '♟ Open the game' : "♟ O'yinni ochish"),
        };
      } else if (room?.status === 'waiting') {
        const who = escapeHtml(owner?.username ?? (en ? 'A friend' : "Do'stingiz"));
        reply = {
          text: en
            ? `♟ <b>${who}</b> invites you to a game of checkers on DAMEO!\n\nRoom: <b>${roomCode}</b>\nTap the button below to join 👇`
            : `♟ <b>${who}</b> sizni DAMEO'da shashka o'ynashga taklif qildi!\n\nXona: <b>${roomCode}</b>\nQo'shilish uchun pastdagi tugmani bosing 👇`,
          button: open(`#/play?mode=friends&join=${roomCode}`, en ? '♟ Join the room' : "♟ Xonaga qo'shilish"),
        };
      } else {
        reply = {
          text: en
            ? `⚠️ Room <b>${roomCode}</b> is not available: it was not found, or the game has already started or ended.\n\nAsk your friend for a new invitation, or start a game yourself 👇`
            : `⚠️ <b>${roomCode}</b> xonasi mavjud emas: topilmadi yoki o'yin allaqachon boshlangan/tugagan.\n\nDo'stingizdan yangi taklif so'rang yoki o'zingiz o'yin boshlang 👇`,
          button: open('#/play?mode=friends', en ? '♟ Open the game' : "♟ O'yinni ochish"),
        };
      }
      const roomMsg = { chat_id: msg.chat.id, text: reply.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
      const sentRoom = await tg(token, 'sendMessage', { ...roomMsg, reply_markup: { inline_keyboard: [[reply.button]] } });
      if (!sentRoom?.ok) {
        const { style: _s, ...plain } = reply.button;
        await tg(token, 'sendMessage', { ...roomMsg, reply_markup: { inline_keyboard: [[plain]] } });
      }
      return new Response('ok');
    }
    // "/start join_ABC123" (deep link) opens the game straight into that room
    const param = text.split(' ')[1] ?? '';
    const appUrl = /^join_[A-Z0-9]{4,8}$/i.test(param) ? `${WEBAPP_URL}#/play?mode=friends&join=${param.slice(5).toUpperCase()}` : WEBAPP_URL;
    // coloured buttons (Bot API `style`): green = play, blue = channel; older apps show them in the default colour
    const buttons = [
      [{ text: lang?.startsWith('en') ? '♟ Play now' : "♟ O'yinni boshlash", web_app: { url: appUrl }, style: 'success' }],
      [{ text: lang?.startsWith('en') ? '📢 Our channel' : '📢 Bizning kanal', url: CHANNEL_URL, style: 'primary' }],
    ];
    const welcomeMsg = { chat_id: msg.chat.id, text: welcome(lang, name), parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    const sent = await tg(token, 'sendMessage', { ...welcomeMsg, reply_markup: { inline_keyboard: buttons } });
    if (!sent?.ok) {
      // if Telegram ever refuses the colours, send the same message with plain buttons
      await tg(token, 'sendMessage', { ...welcomeMsg, reply_markup: { inline_keyboard: buttons.map((row) => row.map(({ style: _s, ...b }) => b)) } });
    }
  }
  return new Response('ok'); // always 200 so Telegram does not retry
});
