-- DAMEO 0003: Telegram accounts, server-side bot opponents, fixed ±5 rating.

alter table public.profiles add column if not exists tg_id bigint unique;
revoke update (tg_id) on public.profiles from authenticated;          -- only the telegram-auth function sets it

alter table public.matches add column if not exists vs_bot boolean not null default false;
alter table public.matches add column if not exists bot_level text check (bot_level in ('easy','medium','hard'));
alter table public.matches add constraint bot_match_shape check (not vs_bot or (black_id is null and bot_level is not null));

-- Rating: win +5, loss -5, draw 0 (floor 100). Same rule in src/services/rating.ts.
create or replace function public.rating_delta(p_player int, p_opp int, p_score numeric, p_games int)
returns int language sql immutable set search_path = public as $$
  select greatest(100, p_player + case when p_score = 1 then 5 when p_score = 0 then -5 else 0 end) - p_player;
$$;

-- Applies the rating change for a finished rated match exactly once (human vs human, or human vs server bot).
create or replace function public.apply_match_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  w public.profiles%rowtype;
  b public.profiles%rowtype;
  ws numeric; wd int; bd int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'finished' or m.rating_applied or not m.rated then return; end if;
  if m.black_id is null and not m.vs_bot then return; end if;
  ws := case m.result when 'white' then 1 when 'draw' then 0.5 else 0 end;
  select * into w from public.profiles where id = m.white_id for update;
  wd := public.rating_delta(w.rating, 1200, ws, w.rated_games);
  update public.profiles set rating = rating + wd, rated_games = rated_games + 1, last_delta = wd,
         wins = wins + (m.result = 'white')::int, losses = losses + (m.result = 'black')::int, draws = draws + (m.result = 'draw')::int
   where id = w.id;
  insert into public.rating_history (user_id, match_id, rating) values (w.id, m.id, w.rating + wd);
  if not m.vs_bot then
    select * into b from public.profiles where id = m.black_id for update;
    bd := public.rating_delta(b.rating, 1200, 1 - ws, b.rated_games);
    update public.profiles set rating = rating + bd, rated_games = rated_games + 1, last_delta = bd,
           wins = wins + (m.result = 'black')::int, losses = losses + (m.result = 'white')::int, draws = draws + (m.result = 'draw')::int
     where id = b.id;
    insert into public.rating_history (user_id, match_id, rating) values (b.id, m.id, b.rating + bd);
  end if;
  update public.matches set rating_applied = true, white_delta = wd, black_delta = bd where id = m.id;
end $$;

-- Start a rated game against the server bot. The human is always White; 'random' lets the server pick the level.
create or replace function public.start_bot_match(p_level text default 'random') returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lvl text := p_level; r float; m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if lvl not in ('easy','medium','hard') then
    r := random();
    lvl := case when r < 0.4 then 'easy' when r < 0.8 then 'medium' else 'hard' end;
  end if;
  update public.matches set status = 'aborted', ended_at = now()
   where white_id = uid and vs_bot and status = 'active';               -- one live bot game per player
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, started_at)
  values (uid, 'active', true, true, lvl, now()) returning * into m;
  return json_build_object('match_id', m.id, 'level', lvl);
end $$;
revoke execute on function public.start_bot_match(text) from public, anon;
grant execute on function public.start_bot_match(text) to authenticated;

-- Views: expose the bot to the UI (new columns are appended at the end).
create or replace view public.match_view with (security_invoker = true) as
  select m.id,
         case when auth.uid() in (m.white_id, m.black_id) then m.code end as code,
         m.white_id, m.black_id, m.status, m.result, m.result_reason, m.rated, m.move_count, m.created_at,
         wp.username as white_name, wp.rating as white_rating,
         coalesce(bp.username, case when m.vs_bot then 'DAMEO Bot' end) as black_name,
         coalesce(bp.rating, case when m.vs_bot then 1200 end) as black_rating,
         m.vs_bot, m.bot_level
  from public.matches m
  join public.profiles wp on wp.id = m.white_id
  left join public.profiles bp on bp.id = m.black_id;

create or replace view public.match_history with (security_invoker = true) as
  select m.id as match_id, m.white_id as user_id, m.ended_at,
         coalesce(bp.username, 'DAMEO Bot · ' || m.bot_level) as opponent_name,
         case m.result when 'white' then 'win' when 'black' then 'loss' else 'draw' end as result,
         m.white_delta as delta, m.rated, m.move_count as moves
  from public.matches m left join public.profiles bp on bp.id = m.black_id
  where m.status = 'finished' and (m.black_id is not null or m.vs_bot)
  union all
  select m.id, m.black_id, m.ended_at, wp.username,
         case m.result when 'black' then 'win' when 'white' then 'loss' else 'draw' end,
         m.black_delta, m.rated, m.move_count
  from public.matches m join public.profiles wp on wp.id = m.white_id where m.status = 'finished' and m.black_id is not null;
