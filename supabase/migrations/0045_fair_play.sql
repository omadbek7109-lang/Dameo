-- 0045 — Fair play (modelled on Lichess "playban" and Chess.com's sportsmanship rules).
--  1. A game that ends before 12 moves changes nobody's rating (before: < 6 moves, the loser still lost −10…−30, so
--     resigning / timing out on move 1–2 again and again was the quickest way to drop a rating on purpose).
--  2. Early quit = a rated game you lost by resigning or running out of time before move 12 (you made 0–5 moves).
--     • 3 early quits within 24 h → a warning, shown on screen (quick match + after the game).
--     • Another early quit while warned (24 h) → playban: quick match (real and virtual opponents) closed for
--       15 min; again within 7 days → 1 h; after that → 24 h. The reason and the time left are shown.
--     • Rooms with friends stay open. Nothing else is taken away (coins, rating, items).
--  3. Admins: list of warned / banned players with their early quits, and a "clear" action.
-- Existing ratings, coins and history are not touched.

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

  wd := public._rand_delta(ws, w.rating, coalesce(b.rating, v.rating));
  bd := public._rand_delta(1 - ws, coalesce(b.rating, v.rating), w.rating);
  -- ended before 12 moves: nobody's rating changes (0045; before: < 6 moves, the loser still lost)
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

-- ---------------------------------------------------------------- early quits, warnings, playbans
create table if not exists public.fair_play_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null unique,
  moves int not null,
  at timestamptz not null default now()
);
create index if not exists fair_play_events_user_at on public.fair_play_events (user_id, at desc);
alter table public.fair_play_events enable row level security;

create table if not exists public.fair_play (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  warned_at timestamptz,
  ban_until timestamptz,
  ban_minutes int,
  bans timestamptz[] not null default '{}',          -- start times of playbans (for the 7-day escalation)
  updated_at timestamptz not null default now()
);
alter table public.fair_play enable row level security;
revoke all on public.fair_play_events, public.fair_play from anon, authenticated;
grant select, insert, update on public.fair_play_events, public.fair_play to service_role;

-- called once per rated game, right after its rating is applied
create or replace function public._fair_play_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare loser uuid; n24 int; fp public.fair_play; recent int; mins int;
begin
  if new.result is null or new.result = 'draw' or coalesce(new.move_count, 0) >= 12 then return new; end if;
  if not (new.result_reason = 'resign' or new.timeout_kind is not null) then return new; end if;
  loser := case when new.result = 'white' then new.black_id else new.white_id end;   -- virtual players: null
  if loser is null then return new; end if;
  begin
    insert into public.fair_play_events (user_id, match_id, moves) values (loser, new.id, coalesce(new.move_count, 0))
    on conflict (match_id) do nothing;
    if not found then return new; end if;
    insert into public.fair_play (user_id) values (loser) on conflict (user_id) do nothing;
    select * into fp from public.fair_play where user_id = loser for update;
    select count(*) into n24 from public.fair_play_events where user_id = loser and at > now() - interval '24 hours';
    if fp.warned_at is not null and fp.warned_at > now() - interval '24 hours' then
      -- already warned: playban, longer each time within 7 days
      select count(*) into recent from unnest(fp.bans) b where b > now() - interval '7 days';
      mins := case when recent = 0 then 15 when recent = 1 then 60 else 1440 end;
      update public.fair_play
         set ban_until = greatest(coalesce(ban_until, now()), now()) + make_interval(mins => mins), ban_minutes = mins,
             bans = array(select b from unnest(fp.bans) b where b > now() - interval '7 days') || now(),
             updated_at = now()
       where user_id = loser;
      update public.matchmaking_queue set last_seen = '-infinity' where user_id = loser;
    elsif n24 >= 3 then
      update public.fair_play set warned_at = now(), updated_at = now() where user_id = loser;
    end if;
  exception when others then
    raise warning 'fair play note failed for match %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public._fair_play_note() from public, anon, authenticated;

create or replace trigger matches_fair_play
  after update of rating_applied on public.matches
  for each row when (new.rating_applied and not old.rating_applied)
  execute function public._fair_play_note();

-- my fair-play state (for the app)
create or replace function public.fair_play_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'early_24h', (select count(*) from public.fair_play_events e where e.user_id = auth.uid() and e.at > now() - interval '24 hours'),
    'warned', coalesce(fp.warned_at > now() - interval '24 hours', false),
    'warned_at', fp.warned_at,
    'ban_until', case when fp.ban_until > now() then fp.ban_until end,
    'ban_minutes', case when fp.ban_until > now() then fp.ban_minutes end,
    'server_now', clock_timestamp())
  from (select 1) one left join public.fair_play fp on fp.user_id = auth.uid()
$$;
revoke all on function public.fair_play_status() from public, anon;
grant execute on function public.fair_play_status() to authenticated;

create or replace function public._playban_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ban_until from public.fair_play where user_id = p_user and ban_until > now()
$$;
revoke all on function public._playban_until(uuid) from public, anon, authenticated;

create or replace function public.quick_match(p_time integer) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz; blk timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
  blk := public._playban_until(uid);
  if blk is not null then
    update public.matchmaking_queue set last_seen = '-infinity' where user_id = uid;
    return json_build_object('match_id', null, 'blocked_until', blk, 'reason', 'early-quit', 'server_now', clock_timestamp(), 'time_control', p_time);
  end if;
  select * into me from public.profiles where id = uid;
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and q.last_seen > now() - interval '15 seconds' and q.time_control = p_time
     and public._playban_until(q.user_id) is null
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
  blk := public._playban_until(uid);
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

-- ---------------------------------------------------------------- admin
create or replace function public.admin_fair_play_list() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.view');
begin
  return coalesce((
    select json_agg(r order by r.ban_until desc nulls last, r.warned_at desc)
    from (
      select f.user_id as id, p.username, p.rating, f.warned_at, case when f.ban_until > now() then f.ban_until end as ban_until,
             f.ban_minutes, coalesce(array_length(f.bans, 1), 0) as bans_7d,
             (select count(*) from public.fair_play_events e where e.user_id = f.user_id and e.at > now() - interval '24 hours') as early_24h,
             (select count(*) from public.fair_play_events e where e.user_id = f.user_id and e.at > now() - interval '7 days') as early_7d
        from public.fair_play f join public.profiles p on p.id = f.user_id
       where f.warned_at > now() - interval '7 days' or f.ban_until > now() - interval '7 days'
       limit 100) r), '[]'::json);
end $$;
revoke all on function public.admin_fair_play_list() from public, anon;
grant execute on function public.admin_fair_play_list() to authenticated;

-- lift a warning / playban (mistake, bad internet …); logged
create or replace function public.admin_fair_play_clear(p_user uuid, p_reason text default null) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.ban');
begin
  update public.fair_play set warned_at = null, ban_until = null, ban_minutes = null, bans = '{}', updated_at = now() where user_id = p_user;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, details)
  values (uid, 'fair_play.clear', 'user', p_user::text, left(coalesce(p_reason, ''), 300), '{}'::jsonb);
  return json_build_object('ok', true);
end $$;
revoke all on function public.admin_fair_play_clear(uuid, text) from public, anon;
grant execute on function public.admin_fair_play_clear(uuid, text) to authenticated;
