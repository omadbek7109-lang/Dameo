// Edge Function `daily-winner` (Deno): announces each day's daily-rating winner (migration 0031).
//  - Woken by pg_cron (daily_tick → pg_net) a few minutes after Tashkent midnight; also safe to call by hand.
//  - It has no input: it only sends what the database marks as pending (daily_notify_claim), and records the result
//    (daily_notify_done), so a repeated call never messages anybody twice. Nothing can be triggered from outside.
//  - Winner: "you won" message from the bot (if the account is linked to Telegram and has not blocked the bot).
//  - Super admin: an audit — Telegram @username or id, real-account check (getChat), games, wins, opponents, runner-up,
//    and whether the winner got the message. The gift itself (Ayiqcha, 15 ⭐) is sent by the admin.
// The bot token is the Supabase secret TELEGRAM_BOT_TOKEN and never reaches the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBAPP_URL = Deno.env.get('DAMEO_WEBAPP_URL') ?? 'https://omadbek7109-lang.github.io/Dameo/';
const ADMIN_CHAT = Number(Deno.env.get('DAMEO_ADMIN_CHAT') ?? '7550418397');
const PRIZE = 'Ayiqcha Gift (15 ⭐)';
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayUz = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]} ${y}`;
};
const dateUz = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Tashkent' }).replace(/\//g, '.');

type TgResult = { ok: boolean; error_code?: number; description?: string; result?: any };
async function tg(token: string, method: string, body: unknown): Promise<TgResult> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()) as TgResult;
  } catch (e) {
    return { ok: false, description: `network: ${(e as Error).message}` };
  }
}

// green "open" button; older Telegram apps reject `style` → resend without it
async function sendWithButton(token: string, chat: number, text: string, label: string, hash = '') {
  const base = { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const button = { text: label, web_app: { url: `${WEBAPP_URL}${hash}` } };
  let r = await tg(token, 'sendMessage', { ...base, reply_markup: { inline_keyboard: [[{ ...button, style: 'success' }]] } });
  if (!r.ok && r.error_code === 400 && !/chat not found/i.test(r.description ?? '')) r = await tg(token, 'sendMessage', { ...base, reply_markup: { inline_keyboard: [[button]] } });
  return r;
}

interface Row {
  day: string;
  user_id: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  pvp_games: number;
  virtual_games: number;
  opponents: number;
  reached_at: string | null;
  runner_up: { username: string; points: number; games: number } | null;
  players: number;
  tg_id: number | string | null;
  username: string | null;
  winner_notified_at: string | null;
  winner_error: string | null;
  admin_notified_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return json({ ok: false }, 405);
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json({ ok: false, error: 'not-configured' }, 503);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await db.rpc('daily_notify_claim');
  if (error) return json({ ok: false, error: 'db' }, 500);
  const rows = (data ?? []) as Row[];
  const done: unknown[] = [];

  for (const w of rows) {
    const tgId = w.tg_id == null ? null : Number(w.tg_id);
    const { data: prof } = await db.from('profiles').select('created_at, rating').eq('id', w.user_id).maybeSingle();

    // who is this on Telegram (works for anyone who opened the bot or the Mini App)
    let chat: any = null;
    if (tgId) {
      const c = await tg(token, 'getChat', { chat_id: tgId });
      if (c.ok) chat = c.result;
    }

    // 1) the winner
    let winnerOk = !!w.winner_notified_at;
    let winnerErr = w.winner_error ?? '';
    if (!winnerOk && !winnerErr) {
      if (!tgId) winnerErr = 'no-telegram';
      else {
        const text =
          `🏆 <b>Tabriklaymiz, ${esc(w.username)}!</b>\n\n` +
          `Siz <b>${dayUz(w.day)}</b> kunlik reytingida <b>1-o'rinni</b> egalladingiz — <b>+${w.points}</b> ball ` +
          `(${w.games} ta o'yin, ${w.wins} ta g'alaba).\n\n` +
          `🎁 Sovriningiz: <b>🧸 ${PRIZE}</b> — tez orada Telegram orqali yuboriladi.\n\n` +
          `Bugungi reyting 00:00 da yangidan boshlandi — yana g'olib bo'ling! ♟`;
        const r = await sendWithButton(token, tgId, text, '🏆 Kunlik reyting', '#/leaderboard?tab=tournaments');
        if (r.ok) winnerOk = true;
        else if (r.error_code === 403 || r.error_code === 400) winnerErr = (r.description ?? `error ${r.error_code}`).slice(0, 200);
        // other errors (429, 5xx, network): left pending → retried on the next tick
      }
    }

    // 2) the super admin audit
    let adminOk = !!w.admin_notified_at;
    if (!adminOk) {
      const tgUser = chat?.username ? `@${esc(chat.username)}` : null;
      const tgName = [chat?.first_name, chat?.last_name].filter(Boolean).join(' ');
      const who = tgId
        ? `${tgUser ?? '<i>username yo\'q</i>'} · ID: <code>${tgId}</code> · <a href="tg://user?id=${tgId}">profilni ochish</a>`
        : "❗ Telegram bog'lanmagan (sovrin yuborib bo'lmaydi)";
      const real = !tgId
        ? "❌ yo'q"
        : chat
          ? `✅ ha — Telegram akkaunt${tgName ? ` (${esc(tgName)})` : ''}${chat.type && chat.type !== 'private' ? ` [${esc(chat.type)}]` : ''}`
          : '⚠️ Telegram ID bor, lekin bot u bilan gaplasha olmaydi (botni ochmagan yoki bloklagan)';
      const winnerLine = winnerOk ? '✅ yuborildi' : winnerErr ? `❌ yuborilmadi — ${esc(winnerErr === 'no-telegram' ? "Telegram bog'lanmagan" : winnerErr)}` : '⏳ keyinroq qayta urinadi';
      const ru = w.runner_up ? `${esc(w.runner_up.username)} — +${w.runner_up.points} (${w.runner_up.games} o'yin)` : '—';
      const text =
        `🏆 <b>KUNLIK REYTING G'OLIBI</b> — ${dayUz(w.day)}\n\n` +
        `👤 O'yinchi: <b>${esc(w.username)}</b>\n` +
        `✈️ Telegram: ${who}\n` +
        `🔎 Haqiqiy foydalanuvchi: ${real}\n` +
        (prof?.created_at ? `📅 Akkaunt ochilgan: ${dateUz(prof.created_at)}\n` : '') +
        (prof?.rating ? `📈 Hozirgi reyting: ${prof.rating}\n` : '') +
        `\n🎯 Kunlik ball: <b>+${w.points}</b>\n` +
        `🎮 O'yinlar: <b>${w.games}</b> — ${w.wins} g'alaba · ${w.losses} mag'lubiyat · ${w.draws} durang\n` +
        `   • odamlar bilan: ${w.pvp_games} · virtual raqiblar bilan: ${w.virtual_games}\n` +
        `   • turli raqiblar: ${w.opponents}\n` +
        `🥈 2-o'rin: ${ru}\n` +
        `👥 O'sha kuni reytingda: ${w.players} kishi\n\n` +
        `🎁 Sovrin: <b>🧸 ${PRIZE}</b> — g'olibga yuboring.\n` +
        `📨 G'olibga xabar: ${winnerLine}`;
      const r = await tg(token, 'sendMessage', { chat_id: ADMIN_CHAT, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      adminOk = r.ok;
    }

    await db.rpc('daily_notify_done', { p_day: w.day, p_winner_ok: winnerOk, p_winner_error: winnerErr, p_admin_ok: adminOk });
    done.push({ day: w.day, winner: winnerOk, admin: adminOk });
  }
  return json({ ok: true, done });
});
