// Edge Function `match-action` (Deno). The ONLY way moves, resignations and results reach the database.
// - Replays the stored game with the same engine as the client and rejects illegal moves.
// - In games against the server bot it computes and stores the bot's reply (the client never plays the bot's moves).
// - Applies the rating (±5) exactly once via the service-role-only SQL function apply_match_result.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { playMove, replay } from '../_shared/engine/index.ts';
import type { GameResult, GameState } from '../_shared/engine/index.ts';
import { chooseMove, type Difficulty } from '../_shared/bot/ai.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const BOT_TIME: Record<Difficulty, number> = { easy: 150, medium: 450, hard: 700 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

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
  const { action, match_id } = body ?? {};
  if (typeof match_id !== 'string' || !['move', 'resign'].includes(action)) return json({ ok: false, error: 'bad-request' }, 400);

  const { data: match } = await admin.from('matches').select('*').eq('id', match_id).maybeSingle();
  if (!match) return json({ ok: false, error: 'not-found' }, 404);
  if (uid !== match.white_id && uid !== match.black_id) return json({ ok: false, error: 'forbidden' }, 403);
  if (match.status !== 'active') return json({ ok: false, error: 'not-active' }, 409);
  const myColor = uid === match.white_id ? 'w' : 'b';

  const finish = async (result: 'white' | 'black' | 'draw', reason: string, moveCount: number) => {
    const { data: upd } = await admin
      .from('matches')
      .update({ status: 'finished', result, result_reason: reason, move_count: moveCount, ended_at: new Date().toISOString() })
      .eq('id', match_id)
      .eq('status', 'active')
      .select('id');
    if (upd && upd.length > 0 && match.rated) await admin.rpc('apply_match_result', { p_match: match_id });
  };
  const finishIfOver = async (r: GameResult, plies: number) => {
    if (r.status === 'won') await finish(r.winner === 'w' ? 'white' : 'black', r.reason, plies);
    else if (r.status === 'draw') await finish('draw', r.reason, plies);
  };

  if (action === 'resign') {
    const { count } = await admin.from('match_moves').select('*', { count: 'exact', head: true }).eq('match_id', match_id);
    await finish(myColor === 'w' ? 'black' : 'white', 'resign', count ?? 0);
    return json({ ok: true });
  }

  const from = Number(body.from);
  const path: number[] = Array.isArray(body.path) ? body.path.map(Number) : [];
  if (!Number.isInteger(from) || path.length === 0 || path.length > 32 || path.some((n) => !Number.isInteger(n) || n < 0 || n > 63)) {
    return json({ ok: false, error: 'bad-move' }, 400);
  }
  const { data: rows } = await admin.from('match_moves').select('ply, from_sq, path').eq('match_id', match_id).order('ply', { ascending: true });
  const stored = (rows ?? []).map((r: any) => ({ from: r.from_sq, path: r.path as number[] }));
  const replayed = replay(stored);
  if (!replayed.ok) return json({ ok: false, error: 'corrupt-game' }, 500);
  if (replayed.state.turn !== myColor) return json({ ok: false, error: 'not-your-turn' }, 409);
  const out = playMove(replayed.state, from, path);
  if (!out.ok) return json({ ok: false, error: out.error ?? 'illegal' }, 422);

  let ply = stored.length;
  const { error: insErr } = await admin.from('match_moves').insert({ match_id, ply, from_sq: from, path });
  if (insErr) return json({ ok: false, error: 'conflict' }, 409); // PK (match_id, ply) blocks double submits
  ply++;
  let state: GameState = out.state;
  let bot: { ply: number; from: number; path: number[] } | null = null;

  if (match.vs_bot && state.result.status === 'playing') {
    const m = chooseMove(state, match.bot_level as Difficulty, { timeMs: BOT_TIME[match.bot_level as Difficulty] ?? 400 });
    if (m) {
      const applied = playMove(state, m.from, m.path);
      if (applied.ok) {
        const { error } = await admin.from('match_moves').insert({ match_id, ply, from_sq: m.from, path: m.path });
        if (!error) {
          bot = { ply, from: m.from, path: m.path };
          ply++;
          state = applied.state;
        }
      }
    }
  }
  await admin.from('matches').update({ move_count: ply }).eq('id', match_id);
  await finishIfOver(state.result, ply);
  return json({ ok: true, bot, result: state.result });
});
