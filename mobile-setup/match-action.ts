// DAMEO Edge Function "match-action" — single-file bundle (generated from supabase/functions/match-action).
// supabase/functions/match-action/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
// supabase/functions/_shared/engine/rules.ts
var SIZE = 8;
var DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
];
var isDark = (r, c) => (r + c) % 2 === 1;
var rc = (i) => [i / SIZE | 0, i % SIZE];
var idx = (r, c) => r * SIZE + c;
var inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
var colorOf = (cell) => cell > 0 ? "w" : cell < 0 ? "b" : null;
var isKing = (cell) => cell === 2 || cell === -2;
var opponent = (c) => c === "w" ? "b" : "w";
var forward = (c) => c === "w" ? -1 : 1;
var promotionRow = (c) => c === "w" ? 0 : SIZE - 1;
function initialBoard() {
  const b = new Array(64).fill(0);
  for (let r = 0;r < SIZE; r++) {
    for (let c = 0;c < SIZE; c++) {
      if (!isDark(r, c))
        continue;
      if (r < 3)
        b[idx(r, c)] = -1;
      else if (r > 4)
        b[idx(r, c)] = 1;
    }
  }
  return b;
}
function positionKey(board, turn) {
  let s = turn;
  for (const c of board)
    s += c === 0 ? "." : c === 1 ? "w" : c === 2 ? "W" : c === -1 ? "b" : "B";
  return s;
}
function initialState() {
  const board = initialBoard();
  return {
    board,
    turn: "w",
    history: [],
    result: { status: "playing" },
    quietPlies: 0,
    seen: { [positionKey(board, "w")]: 1 }
  };
}
function searchCaptures(ctx, pos, king, captured, path, promoted, out) {
  const { board, color, origin } = ctx;
  const [r0, c0] = rc(pos);
  let foundAny = false;
  const isEmpty = (i) => board[i] === 0 || i === origin;
  for (const [dr, dc] of DIRS) {
    if (king) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && isEmpty(idx(r, c))) {
        r += dr;
        c += dc;
      }
      if (!inside(r, c))
        continue;
      const victim = idx(r, c);
      if (colorOf(board[victim]) !== opponent(color) || captured.includes(victim))
        continue;
      const landings = [];
      let lr = r + dr;
      let lc = c + dc;
      while (inside(lr, lc) && isEmpty(idx(lr, lc))) {
        landings.push(idx(lr, lc));
        lr += dr;
        lc += dc;
      }
      if (landings.length === 0)
        continue;
      foundAny = true;
      const nextCaptured = [...captured, victim];
      const continuing = [];
      for (const land of landings) {
        const canContinue = searchCaptures(ctx, land, true, nextCaptured, [...path, land], promoted, []);
        if (canContinue)
          continuing.push(land);
      }
      const chosen = continuing.length > 0 ? continuing : landings;
      for (const land of chosen) {
        searchCaptures(ctx, land, true, nextCaptured, [...path, land], promoted, out);
      }
    } else {
      const r1 = r0 + dr;
      const c1 = c0 + dc;
      const r2 = r0 + 2 * dr;
      const c2 = c0 + 2 * dc;
      if (!inside(r2, c2))
        continue;
      const victim = idx(r1, c1);
      const land = idx(r2, c2);
      if (colorOf(board[victim]) !== opponent(color) || captured.includes(victim))
        continue;
      if (!isEmpty(land))
        continue;
      foundAny = true;
      const nextCaptured = [...captured, victim];
      const becomesKing = r2 === promotionRow(color);
      searchCaptures(ctx, land, becomesKing, nextCaptured, [...path, land], promoted || becomesKing, out);
    }
  }
  if (!foundAny && captured.length > 0) {
    out.push({ from: origin, to: pos, path, captures: captured, promotes: promoted });
  }
  return foundAny;
}
function capturesFor(board, pos) {
  const cell = board[pos];
  const color = colorOf(cell);
  if (!color)
    return [];
  const out = [];
  searchCaptures({ board, color, origin: pos }, pos, isKing(cell), [], [], false, out);
  return out;
}
function quietFor(board, pos) {
  const cell = board[pos];
  const color = colorOf(cell);
  if (!color)
    return [];
  const [r0, c0] = rc(pos);
  const out = [];
  if (isKing(cell)) {
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[idx(r, c)] === 0) {
        out.push({ from: pos, to: idx(r, c), path: [idx(r, c)], captures: [], promotes: false });
        r += dr;
        c += dc;
      }
    }
  } else {
    const dr = forward(color);
    for (const dc of [-1, 1]) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (inside(r, c) && board[idx(r, c)] === 0) {
        out.push({
          from: pos,
          to: idx(r, c),
          path: [idx(r, c)],
          captures: [],
          promotes: r === promotionRow(color)
        });
      }
    }
  }
  return out;
}
function legalMovesFor(board, color) {
  const captures = [];
  for (let i = 0;i < 64; i++) {
    if (colorOf(board[i]) === color)
      captures.push(...capturesFor(board, i));
  }
  if (captures.length > 0)
    return captures;
  const quiet = [];
  for (let i = 0;i < 64; i++) {
    if (colorOf(board[i]) === color)
      quiet.push(...quietFor(board, i));
  }
  return quiet;
}
function legalMoves(state) {
  if (state.result.status !== "playing")
    return [];
  return legalMovesFor(state.board, state.turn);
}
function applyToBoard(board, move) {
  const next = board.slice();
  const piece = next[move.from];
  next[move.from] = 0;
  for (const c of move.captures)
    next[c] = 0;
  const color = colorOf(piece);
  const reachedEnd = rc(move.to)[0] === promotionRow(color);
  const king = isKing(piece) || move.promotes || reachedEnd && !isKing(piece);
  next[move.to] = (king ? 2 : 1) * (color === "w" ? 1 : -1);
  return next;
}
var squareName = (i) => {
  const [r, c] = rc(i);
  return "abcdefgh"[c] + (8 - r);
};
function notate(m) {
  const sep = m.captures.length > 0 ? ":" : "-";
  return [m.from, ...m.path].map(squareName).join(sep);
}
var sameMove = (a, b) => a.from === b.from && a.path.length === b.path.length && a.path.every((p, i) => p === b.path[i]);
function playMove(state, from, path) {
  if (state.result.status !== "playing")
    return { ok: false, error: "game-over", state };
  const cell = state.board[from];
  if (cell === 0)
    return { ok: false, error: "empty-square", state };
  if (colorOf(cell) !== state.turn)
    return { ok: false, error: "not-your-piece", state };
  const legal = legalMoves(state);
  const wanted = { from, to: path[path.length - 1], path, captures: [], promotes: false };
  const found = legal.find((m) => sameMove(m, wanted));
  if (!found) {
    const mustCapture = legal.some((m) => m.captures.length > 0);
    return { ok: false, error: mustCapture ? "must-capture" : "illegal", state };
  }
  return { ok: true, state: commit(state, found), move: found };
}
function commit(state, move) {
  const mover = state.turn;
  const piece = state.board[move.from];
  const board = applyToBoard(state.board, move);
  const turn = opponent(mover);
  const wasMan = !isKing(piece);
  const quiet = move.captures.length > 0 || wasMan ? 0 : state.quietPlies + 1;
  const key = positionKey(board, turn);
  const seen = { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 };
  const record = {
    color: mover,
    from: move.from,
    path: move.path,
    captures: move.captures,
    promotes: move.promotes || wasMan && rc(move.to)[0] === promotionRow(mover),
    notation: notate(move)
  };
  const next = {
    board,
    turn,
    history: [...state.history, record],
    result: { status: "playing" },
    quietPlies: quiet,
    seen
  };
  next.result = evaluate(next);
  return next;
}
function evaluate(s) {
  if (legalMovesFor(s.board, s.turn).length === 0) {
    return { status: "won", winner: s.turn === "w" ? "b" : "w", reason: "no-moves" };
  }
  if ((s.seen[positionKey(s.board, s.turn)] ?? 0) >= 3)
    return { status: "draw", reason: "repetition" };
  const onlyKings = s.board.every((c) => c === 0 || isKing(c));
  if (onlyKings && s.quietPlies >= 30)
    return { status: "draw", reason: "kings-only" };
  return { status: "playing" };
}
function replay(moves) {
  let s = initialState();
  for (let i = 0;i < moves.length; i++) {
    const out = playMove(s, moves[i].from, moves[i].path);
    if (!out.ok)
      return { ok: false, state: s, badPly: i };
    s = out.state;
  }
  return { ok: true, state: s };
}
// supabase/functions/_shared/bot/ai.ts
var MAN = 100;
var KING = 320;
var WIN = 1e5;
function evaluate2(board, me) {
  let score = 0;
  for (let i = 0;i < 64; i++) {
    const cell = board[i];
    if (cell === 0)
      continue;
    const color = colorOf(cell);
    const [r, c] = rc(i);
    let v;
    if (isKing(cell)) {
      v = KING;
      v += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c));
    } else {
      const progress = color === "w" ? 7 - r : r;
      v = MAN + progress * 5;
      if (progress === 0)
        v += 12;
      if (c >= 2 && c <= 5 && progress >= 2 && progress <= 5)
        v += 3;
    }
    score += color === me ? v : -v;
  }
  return score;
}
function orderMoves(moves) {
  return moves.map((m) => ({ m, k: m.captures.length * 10 + (m.promotes ? 8 : 0) })).sort((a, b) => b.k - a.k).map((x) => x.m);
}

class Searcher {
  deadline;
  nodes = 0;
  aborted = false;
  constructor(deadline) {
    this.deadline = deadline;
  }
  negamax(board, color, depth, alpha, beta, ply) {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline)
      this.aborted = true;
    if (this.aborted)
      return 0;
    const moves = legalMovesFor(board, color);
    if (moves.length === 0)
      return -WIN + ply;
    if (depth <= 0 && !(moves[0].captures.length > 0 && ply < 24))
      return evaluate2(board, color);
    let best = -Infinity;
    for (const m of orderMoves(moves)) {
      const next = applyToBoard(board, m);
      const v = -this.negamax(next, color === "w" ? "b" : "w", depth - 1, -beta, -alpha, ply + 1);
      if (this.aborted)
        return 0;
      if (v > best)
        best = v;
      if (best > alpha)
        alpha = best;
      if (alpha >= beta)
        break;
    }
    return best;
  }
}
function scoreRoot(board, color, moves, depth, s) {
  const out = [];
  let alpha = -Infinity;
  for (const m of orderMoves(moves)) {
    const v = -s.negamax(applyToBoard(board, m), color === "w" ? "b" : "w", depth - 1, -Infinity, -alpha + 0, 1);
    if (s.aborted)
      return null;
    out.push({ m, v });
    if (v > alpha)
      alpha = v;
  }
  return out;
}
function chooseMove(state, level, opts = {}) {
  const rnd = opts.random ?? Math.random;
  const color = state.turn;
  const moves = legalMovesFor(state.board, color);
  if (moves.length === 0)
    return null;
  if (moves.length === 1)
    return moves[0];
  if (level === "easy") {
    if (rnd() < 0.7)
      return moves[Math.floor(rnd() * moves.length)];
    const s = new Searcher(Infinity);
    const scored = scoreRoot(state.board, color, moves, 1, s);
    scored.sort((a, b) => b.v - a.v);
    return scored[0].m;
  }
  if (level === "medium") {
    const s = new Searcher(Date.now() + (opts.timeMs ?? 600));
    const scored = scoreRoot(state.board, color, moves, 3, s);
    if (!scored)
      return moves[Math.floor(rnd() * moves.length)];
    const top = Math.max(...scored.map((x) => x.v));
    const near = scored.filter((x) => top - x.v <= 8);
    return near[Math.floor(rnd() * near.length)].m;
  }
  const deadline = Date.now() + (opts.timeMs ?? 700);
  let best = orderMoves(moves)[0];
  for (let depth = 2;depth <= 12; depth++) {
    const s = new Searcher(deadline);
    const scored = scoreRoot(state.board, color, moves, depth, s);
    if (!scored)
      break;
    scored.sort((a, b) => b.v - a.v);
    best = scored[0].m;
    if (scored[0].v > WIN / 2)
      break;
    if (Date.now() > deadline)
      break;
  }
  return best;
}

// supabase/functions/match-action/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
var BOT_TIME = { easy: 150, medium: 450, hard: 700 };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json({ ok: false, error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData.user)
    return json({ ok: false, error: "unauthorized" }, 401);
  const uid = userData.user.id;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }
  const { action, match_id } = body ?? {};
  if (typeof match_id !== "string" || !["move", "resign"].includes(action))
    return json({ ok: false, error: "bad-request" }, 400);
  const { data: match } = await admin.from("matches").select("*").eq("id", match_id).maybeSingle();
  if (!match)
    return json({ ok: false, error: "not-found" }, 404);
  if (uid !== match.white_id && uid !== match.black_id)
    return json({ ok: false, error: "forbidden" }, 403);
  if (match.status !== "active")
    return json({ ok: false, error: "not-active" }, 409);
  const myColor = uid === match.white_id ? "w" : "b";
  const finish = async (result, reason, moveCount) => {
    const { data: upd } = await admin.from("matches").update({ status: "finished", result, result_reason: reason, move_count: moveCount, ended_at: new Date().toISOString() }).eq("id", match_id).eq("status", "active").select("id");
    if (upd && upd.length > 0 && match.rated)
      await admin.rpc("apply_match_result", { p_match: match_id });
  };
  const finishIfOver = async (r, plies) => {
    if (r.status === "won")
      await finish(r.winner === "w" ? "white" : "black", r.reason, plies);
    else if (r.status === "draw")
      await finish("draw", r.reason, plies);
  };
  if (action === "resign") {
    const { count } = await admin.from("match_moves").select("*", { count: "exact", head: true }).eq("match_id", match_id);
    await finish(myColor === "w" ? "black" : "white", "resign", count ?? 0);
    return json({ ok: true });
  }
  const from = Number(body.from);
  const path = Array.isArray(body.path) ? body.path.map(Number) : [];
  if (!Number.isInteger(from) || path.length === 0 || path.length > 32 || path.some((n) => !Number.isInteger(n) || n < 0 || n > 63)) {
    return json({ ok: false, error: "bad-move" }, 400);
  }
  const { data: rows } = await admin.from("match_moves").select("ply, from_sq, path").eq("match_id", match_id).order("ply", { ascending: true });
  const stored = (rows ?? []).map((r) => ({ from: r.from_sq, path: r.path }));
  const replayed = replay(stored);
  if (!replayed.ok)
    return json({ ok: false, error: "corrupt-game" }, 500);
  if (replayed.state.turn !== myColor)
    return json({ ok: false, error: "not-your-turn" }, 409);
  const out = playMove(replayed.state, from, path);
  if (!out.ok)
    return json({ ok: false, error: out.error ?? "illegal" }, 422);
  let ply = stored.length;
  let clock = null;
  if (!match.vs_bot) {
    const { data: ct, error: ctErr } = await admin.rpc("clock_take_turn", { p_match: match_id, p_ply: ply });
    if (ctErr || !ct)
      return json({ ok: false, error: "server" }, 500);
    if (!ct.ok)
      return json({ ok: false, error: ct.error ?? "conflict" }, 409);
    clock = ct;
  }
  const { error: insErr } = await admin.from("match_moves").insert({ match_id, ply, from_sq: from, path });
  if (insErr) {
    if (clock)
      await admin.from("matches").update({ move_count: ply }).eq("id", match_id).eq("move_count", ply + 1).eq("status", "active");
    return json({ ok: false, error: "conflict" }, 409);
  }
  ply++;
  let state = out.state;
  let bot = null;
  if (match.vs_bot && state.result.status === "playing") {
    const m = chooseMove(state, match.bot_level, { timeMs: BOT_TIME[match.bot_level] ?? 400 });
    if (m) {
      const applied = playMove(state, m.from, m.path);
      if (applied.ok) {
        const { error } = await admin.from("match_moves").insert({ match_id, ply, from_sq: m.from, path: m.path });
        if (!error) {
          bot = { ply, from: m.from, path: m.path };
          ply++;
          state = applied.state;
        }
      }
    }
  }
  await admin.from("matches").update({ move_count: ply }).eq("id", match_id).lt("move_count", ply);
  await finishIfOver(state.result, ply);
  return json({ ok: true, bot, result: state.result, clock });
});
