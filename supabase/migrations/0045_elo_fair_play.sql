-- 0045 — Fair play: real Elo, 12-move rule, early-quit cooldown, suspicious-accounts list for admins.
--  * Rating change = Elo (K = 40) instead of a random ±10…30: equal players ±20; beating a much weaker player gives
--    almost nothing (min +1), losing to one costs up to −40. Dropping your own rating on purpose, or farming a
--    low-rated account, gains nothing. Draw: the lower-rated player gains a little (Elo, at most ±10).
--  * A game that ends before 12 moves changes nobody's rating (before: < 6 moves, the loser still lost). A loss only
--    costs points if you played it out, so dropping points on purpose takes long real games.
--  * Leaving early: 3 games lost in the last hour by resigning / running out of time before move 12 → 10 minutes
--    without quick match (real or virtual opponent). Friends' rooms and challenges are not blocked.
--  * Existing ratings, coins and history are not touched; only games finished from now on use these rules.

create or replace function public._elo_delta(p_score numeric, p_me int, p_opp int) returns int
language sql immutable set search_path = public as $$
  select case
    when p_score = 1 then greatest(1, round(40 * (1 - e))::int)
    when p_score = 0 then least(-1, round(-40 * e)::int)
    else greatest(-10, least(10, round(40 * (0.5 - e))::int)) end
  from (select 1 / (1 + power(10::numeric, (coalesce(p_opp, 1200) - p_me) / 400.0)) as e) x
$$;
revoke all on function public._elo_delta(numeric, int, int) from public, anon, authenticated;

create or replace function public.apply_match_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype; w public.profiles%rowtype; b public.profiles%rowtype; v public.virtual_players%rowtype;
  ws numeric; wd int; bd int; vd int; note text; pair_games int; src text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'finished' or m.rating_applied or not m.rated then return; end if;
  if m.black_id is null and m.virtual_id is null then return; end if;            -- old practice bot: never rated
  ws := case m.result when 'white' then 1 when 'draw' then 0.5 else 0 end;
  src := case when m.virtual_id is not null then 'virtual' else 'pvp' end;
  select * into w from public.profiles where id = m.white_id for update;
  if m.virtual_id is not null then
    select * into v from public.virtual_players where id = m.virtual_id for update;
  else
    select * into b from public.profiles where id = m.black_id for update;
    -- the same pair: at most 5 rated games per 24 h
    select count(*) into pair_games from public.matches x
     where x.id <> m.id and x.rating_applied and coalesce(x.rating_note, 'short') = 'short' and x.ended_at > now() - interval '24 hours'
       and ((x.white_id = m.white_id and x.black_id = m.black_id) or (x.white_id = m.black_id and x.black_id = m.white_id));
    if pair_games >= 5 then note := 'pair-limit'; end if;
  end if;

  if note = 'pair-limit' then
    update public.matches set rating_applied = true, white_delta = 0, black_delta = 0, rating_note = note where id = m.id;
    return;
  end if;

  wd := public._elo_delta(ws, w.rating, coalesce(b.rating, v.rating));
  bd := public._elo_delta(1 - ws, coalesce(b.rating, v.rating), w.rating);
  -- ended before 12 moves: nobody's rating changes (0045)
  if coalesce(m.move_count, 0) < 12 then
    note := 'short';
    wd := 0;
    bd := 0;
  end if;
  wd := greatest(100, w.rating + wd) - w.rating;

  update public.profiles
     set rating = rating + wd, rated_games = rated_games + 1, last_delta = wd,
         wins = wins + (m.result = 'white')::int, losses = losses + (m.result = 'black')::int, draws = draws + (m.result = 'draw')::int,
         current_streak = case when m.result = 'white' then current_streak + 1 else 0 end,
         best_streak = greatest(best_streak, case when m.result = 'white' then current_streak + 1 else 0 end)
   where id = w.id;
  insert into public.rating_history (user_id, match_id, rating, source, delta) values (w.id, m.id, w.rating + wd, src, wd);

  if m.virtual_id is not null then
    vd := greatest(100, least(3000, v.rating + bd)) - v.rating;
    update public.virtual_players set rating = rating + vd where id = v.id;
    bd := vd;
  else
    bd := greatest(100, b.rating + bd) - b.rating;
    update public.profiles
       set rating = rating + bd, rated_games = rated_games + 1, last_delta = bd,
           wins = wins + (m.result = 'black')::int, losses = losses + (m.result = 'white')::int, draws = draws + (m.result = 'draw')::int,
           current_streak = case when m.result = 'black' then current_streak + 1 else 0 end,
           best_streak = greatest(best_streak, case when m.result = 'black' then current_streak + 1 else 0 end)
     where id = b.id;
    insert into public.rating_history (user_id, match_id, rating, source, delta) values (b.id, m.id, b.rating + bd, src, bd);
  end if;

  update public.matches set rating_applied = true, white_delta = wd, black_delta = bd, rating_note = note where id = m.id;
  perform public._ach_check(w.id, m.id);
  if m.black_id is not null then perform public._ach_check(m.black_id, m.id); end if;
end $$;

-- until when this player may not use quick match (null = free): 3 early losses (resign / time) before move 12 in 1 h
create or replace function public._early_quit_block(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when count(*) >= 3 and max(ended_at) + interval '10 minutes' > now() then max(ended_at) + interval '10 minutes' end
  from public.matches
  where status = 'finished' and rated and ended_at > now() - interval '1 hour' and coalesce(move_count, 0) < 12
    and (result_reason = 'resign' or timeout_kind is not null)
    and ((white_id = p_user and result = 'black') or (black_id = p_user and result = 'white'))
$$;
revoke all on function public._early_quit_block(uuid) from public, anon, authenticated;

create or replace function public.quick_match(p_time integer) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz; blk timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
  blk := public._early_quit_block(uid);
  if blk is not null then
    update public.matchmaking_queue set last_seen = '-infinity' where user_id = uid;
    return json_build_object('match_id', null, 'blocked_until', blk, 'server_now', clock_timestamp(), 'time_control', p_time);
  end if;
  select * into me from public.profiles where id = uid;
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and q.last_seen > now() - interval '15 seconds' and q.time_control = p_time
     and public._early_quit_block(q.user_id) is null
   order by abs(q.rating - me.rating), q.created_at limit 1 for update skip locked;
  if found then
    update public.matchmaking_queue set last_seen = '-infinity' where user_id in (uid, other.user_id);
    flip := random() < 0.5;
    insert into public.matches (white_id, black_id, status, rated, started_at, time_control, white_ms, black_ms, turn_started_at)
    values (case when flip then uid else other.user_id end, case when flip then other.user_id else uid end, 'active', true, now(),
            p_time, p_time * 1000, p_time * 1000, now())
    returning * into m;
    return json_build_object('match_id', m.id, 'time_control', p_time);
  end if;
  insert into public.matchmaking_queue (user_id, rating, created_at, last_seen, time_control) values (uid, me.rating, now(), now(), p_time)
  on conflict (user_id) do update set
    rating = excluded.rating,
    created_at = case when public.matchmaking_queue.last_seen < now() - interval '15 seconds'
                        or public.matchmaking_queue.time_control <> excluded.time_control
                      then now() else public.matchmaking_queue.created_at end,
    time_control = excluded.time_control,
    last_seen = now()
  returning created_at into since;
  return json_build_object('match_id', null, 'searching_since', since, 'server_now', clock_timestamp(), 'time_control', p_time);
end $$;

create or replace function public.virtual_match(p_time integer) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q public.matchmaking_queue; me public.profiles; v public.virtual_players; m public.matches; prev record; existing uuid; blk timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  select id into existing from public.matches
   where status = 'active' and not vs_bot and uid in (white_id, black_id) and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if existing is not null then return json_build_object('match_id', existing, 'virtual', null); end if;
  blk := public._early_quit_block(uid);
  if blk is not null then return json_build_object('match_id', null, 'reason', 'blocked', 'blocked_until', blk); end if;
  if not public._virtual_active() then return json_build_object('match_id', null, 'reason', 'disabled'); end if;
  select * into q from public.matchmaking_queue where user_id = uid for update;
  if not found or q.last_seen < now() - interval '20 seconds' or q.time_control <> p_time then
    return json_build_object('match_id', null, 'reason', 'not-searching');
  end if;
  if q.created_at > now() - interval '18 seconds' then return json_build_object('match_id', null, 'reason', 'too-early'); end if;
  select * into me from public.profiles where id = uid;
  select * into v from public._virtual_on_duty() d
   where not exists (select 1 from public.matches x where x.white_id = uid and x.virtual_id = d.id)
   order by random() * (1 + abs(d.rating - me.rating) / 250.0) limit 1;
  if not found then
    select * into v from public.virtual_players d
     where d.enabled and not exists (select 1 from public.matches x where x.white_id = uid and x.virtual_id = d.id)
     order by random() * (1 + abs(d.rating - me.rating) / 250.0) limit 1;
  end if;
  if not found then
    select d.* into v from public.virtual_players d
      left join lateral (select max(x.created_at) as last from public.matches x where x.white_id = uid and x.virtual_id = d.id) pl on true
     where d.enabled
       and d.id is distinct from (select x.virtual_id from public.matches x where x.white_id = uid and x.virtual_id is not null order by x.created_at desc limit 1)
     order by pl.last asc nulls first, random() limit 1;
  end if;
  if not found then select * into v from public.virtual_players d where d.enabled order by random() limit 1; end if;
  if not found then return json_build_object('match_id', null, 'reason', 'disabled'); end if;
  update public.matchmaking_queue set last_seen = '-infinity' where user_id = uid;
  for prev in select id, move_count, rated from public.matches where white_id = uid and vs_bot and status = 'active' for update loop
    if prev.move_count > 0 then
      update public.matches set status = 'finished', result = 'black', result_reason = 'resign', ended_at = now(), bot_pending = null, bot_due_at = null where id = prev.id;
      if prev.rated then perform public.apply_match_result(prev.id); end if;
    else
      update public.matches set status = 'aborted', ended_at = now(), bot_pending = null, bot_due_at = null where id = prev.id;
    end if;
  end loop;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, virtual_id, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (uid, 'active', true, true, case v.level when 'beginner' then 'easy' when 'pro' then 'hard' else 'medium' end, v.id, now(),
          p_time, p_time * 1000, p_time * 1000, now())
  returning * into m;
  return json_build_object('match_id', m.id, 'virtual', json_build_object('id', v.id, 'nickname', v.nickname, 'avatar', v.avatar,
                           'rating', v.rating, 'level', v.level, 'style', v.style, 'wins', v.wins, 'losses', v.losses, 'draws', v.draws));
end $$;

-- Admin: accounts that look like they lose on purpose (last 7 days): many early losses, many games never moved in,
-- or many losses to the same opponent. Read-only.
create or replace function public.admin_suspicious(p_days int default 7)
returns table (id uuid, username text, rating int, games bigint, losses bigint, early_losses bigint, never_moved bigint,
               top_winner text, top_winner_games bigint, banned_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.view');
begin
  return query
  with g as (
    select p.id pid, m.id mid, m.move_count, m.result, m.result_reason, m.timeout_kind,
           (m.white_id = p.id and m.result = 'black') or (m.black_id = p.id and m.result = 'white') as lost,
           case when m.white_id = p.id then m.black_id else m.white_id end as opp
      from public.profiles p
      join public.matches m on (m.white_id = p.id or m.black_id = p.id)
     where m.status = 'finished' and m.rated and m.ended_at > now() - make_interval(days => greatest(1, least(p_days, 60)))
  ), s as (
    select pid, count(*) games, count(*) filter (where lost) losses,
           count(*) filter (where lost and coalesce(move_count, 0) < 12 and (result_reason = 'resign' or timeout_kind is not null)) early,
           count(*) filter (where lost and coalesce(move_count, 0) <= 1 and timeout_kind is not null) never
      from g group by pid
  ), tw as (
    select distinct on (pid) pid, opp, n from (
      select pid, opp, count(*) n from g where lost and opp is not null group by pid, opp) z
    order by pid, n desc
  )
  select p.id, p.username, p.rating, s.games, s.losses, s.early, s.never, w.username, coalesce(tw.n, 0), p.banned_until
    from s join public.profiles p on p.id = s.pid
    left join tw on tw.pid = s.pid left join public.profiles w on w.id = tw.opp
   where s.early >= 5 or s.never >= 5 or coalesce(tw.n, 0) >= 8
   order by (s.early + s.never + coalesce(tw.n, 0)) desc
   limit 50;
end $$;
revoke all on function public.admin_suspicious(int) from public, anon;
grant execute on function public.admin_suspicious(int) to authenticated;
