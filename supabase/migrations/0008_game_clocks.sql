-- DAMEO 0008: clocks for player-vs-player games.
--   * Time control 1 / 3 / 5 minutes per player (chosen when searching; challenges and rooms use 3 minutes).
--   * Chess-clock rule: White's first move is not timed by the clock; after it Black's clock runs,
--     after Black moves Black's clock stops and White's runs, and so on.
--   * At most 30 seconds per move, every move (also White's first). Out of time or over 30 s → the opponent wins.
--   * The server is the only judge: clock_take_turn() is called by the match-action Edge Function before a move is
--     stored; claim_timeout() lets a player end a game whose clock ran out; a pg_cron sweep ends games nobody claims.
-- Additive only: new nullable columns (bot games stay untimed), no column/constraint removed, ratings unchanged (±5).

alter table public.matches add column if not exists time_control int check (time_control in (60, 180, 300));
alter table public.matches add column if not exists white_ms int;
alter table public.matches add column if not exists black_ms int;
alter table public.matches add column if not exists turn_started_at timestamptz;
-- set when a game was lost on time ('move' = the 30 s limit, 'clock' = the player's whole time ran out);
-- result_reason is then 'resign' (the existing reason list is kept as it is)
alter table public.matches add column if not exists timeout_kind text check (timeout_kind in ('move', 'clock'));
alter table public.matchmaking_queue add column if not exists time_control int not null default 180 check (time_control in (60, 180, 300));

create index if not exists matches_clock_idx on public.matches (turn_started_at) where status = 'active' and time_control is not null;

/* ----------------------------------------------------------- clock rules */
-- Who is to move, until when, and which limit applies (the smaller of 30 s and the mover's remaining time).
create or replace function public._clock_deadline(m public.matches, out side text, out deadline timestamptz, out kind text)
language plpgsql stable set search_path = public as $$
declare side_ms int; lim int;
begin
  side := case when m.move_count % 2 = 0 then 'w' else 'b' end;          -- White makes the even plies
  side_ms := case when side = 'w' then m.white_ms else m.black_ms end;
  if m.move_count = 0 or side_ms > 30000 then lim := 30000; kind := 'move';
  else lim := greatest(side_ms, 0); kind := 'clock'; end if;
  deadline := m.turn_started_at + lim * interval '1 millisecond';
end $$;

-- network grace: a move that reaches the server within 1 s after the deadline still counts
create or replace function public._clock_grace() returns interval language sql immutable set search_path = public as $$ select interval '1 second' $$;

-- Ends a game on time (the side to move loses). Returns true when this call ended it.
create or replace function public._flag(p_match uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.matches; d record;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' or m.time_control is null or m.turn_started_at is null then return false; end if;
  d := public._clock_deadline(m);
  if clock_timestamp() <= d.deadline + public._clock_grace() then return false; end if;
  update public.matches
     set status = 'finished', result = case when d.side = 'w' then 'black' else 'white' end, result_reason = 'resign',
         timeout_kind = d.kind, ended_at = now(),
         white_ms = case when d.side = 'w' and d.kind = 'clock' then 0 else white_ms end,
         black_ms = case when d.side = 'b' and d.kind = 'clock' then 0 else black_ms end
   where id = m.id;
  if m.rated then perform public.apply_match_result(m.id); end if;
  return true;
end $$;

-- Called by match-action (service role) right before it stores ply p_ply of a player-vs-player game.
-- Atomically: checks the ply is the next one, checks time, charges the mover's clock and starts the opponent's.
create or replace function public.clock_take_turn(p_match uuid, p_ply int) returns json
language plpgsql security definer set search_path = public as $$
declare m public.matches; d record; t timestamptz := clock_timestamp(); used int; wms int; bms int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then return json_build_object('ok', false, 'error', 'not-active'); end if;
  if m.move_count <> p_ply then return json_build_object('ok', false, 'error', 'conflict'); end if;
  if m.time_control is null or m.turn_started_at is null then           -- untimed game: only claim the ply
    update public.matches set move_count = p_ply + 1 where id = m.id;
    return json_build_object('ok', true);
  end if;
  d := public._clock_deadline(m);
  if t > d.deadline + public._clock_grace() then
    perform public._flag(m.id);
    return json_build_object('ok', false, 'error', 'timeout');
  end if;
  used := greatest(0, round(extract(epoch from (t - m.turn_started_at)) * 1000))::int;
  wms := m.white_ms; bms := m.black_ms;
  if p_ply > 0 then                                                       -- White's first move is free
    if d.side = 'w' then wms := greatest(0, wms - used); else bms := greatest(0, bms - used); end if;
  end if;
  update public.matches set move_count = p_ply + 1, white_ms = wms, black_ms = bms, turn_started_at = t where id = m.id;
  return json_build_object('ok', true, 'white_ms', wms, 'black_ms', bms, 'turn_started_at', t);
end $$;

-- A player (either one) asks the server to end the game because the side to move ran out of time.
create or replace function public.claim_timeout(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; ended boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from public.matches where id = p_match;
  if not found or uid not in (m.white_id, coalesce(m.black_id, m.white_id)) then raise exception 'match not found'; end if;
  ended := public._flag(p_match);
  select * into m from public.matches where id = p_match;
  return json_build_object('ended', ended, 'status', m.status, 'result', m.result);
end $$;

-- Background sweep: ends every timed game whose mover is out of time (nobody has to stay online to claim it).
-- The 30 s cap means an expired game always has turn_started_at older than 31 s, so the index scan is tiny.
create or replace function public.finish_expired_games() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.matches
            where status = 'active' and time_control is not null and turn_started_at < now() - interval '31 seconds' loop
    if public._flag(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Server clock for the client (clock-skew correction of the on-screen clocks).
create or replace function public.server_now() returns timestamptz language sql volatile set search_path = public as $$ select clock_timestamp() $$;

revoke all on function public._clock_deadline(public.matches), public._flag(uuid), public.clock_take_turn(uuid, int),
  public.finish_expired_games() from public, anon, authenticated;
grant execute on function public.clock_take_turn(uuid, int), public.finish_expired_games() to service_role;
revoke execute on function public.claim_timeout(uuid) from public, anon;
grant execute on function public.claim_timeout(uuid) to authenticated;
grant execute on function public.server_now() to anon, authenticated;

/* ------------------------------------------- games now start with a clock */
-- New signature with the time control (seconds). The old no-argument quick_match() stays for older clients (= 3 min).
create or replace function public.quick_match(p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (60, 180, 300) then raise exception 'bad time control'; end if;
  select * into me from public.profiles where id = uid;
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and q.last_seen > now() - interval '15 seconds' and q.time_control = p_time
     and abs(q.rating - me.rating) <= 150 + 10 * extract(epoch from (now() - q.created_at))::int
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
    -- a new search (stale row, or another time control) restarts the 60 s window; pinging keeps it
    created_at = case when public.matchmaking_queue.last_seen < now() - interval '15 seconds'
                        or public.matchmaking_queue.time_control <> excluded.time_control
                      then now() else public.matchmaking_queue.created_at end,
    time_control = excluded.time_control,
    last_seen = now()
  returning created_at into since;
  return json_build_object('match_id', null, 'searching_since', since, 'server_now', clock_timestamp(), 'time_control', p_time);
end $$;

create or replace function public.quick_match() returns json
language sql security definer set search_path = public as $$ select public.quick_match(180) $$;

revoke execute on function public.quick_match(int) from public, anon;
grant execute on function public.quick_match(int) to authenticated;

-- challenges: same as 0006, the game gets a 3-minute clock
create or replace function public.respond_challenge(p_id uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.challenges; m public.matches; flip boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into c from public.challenges where id = p_id and to_id = uid for update;
  if not found then raise exception 'challenge not found'; end if;
  if c.status <> 'pending' then raise exception 'challenge %', c.status; end if;
  if c.created_at < now() - interval '60 seconds' then
    update public.challenges set status = 'cancelled', responded_at = now() where id = c.id;
    raise exception 'challenge expired';
  end if;
  if not p_accept then
    update public.challenges set status = 'declined', responded_at = now() where id = c.id;
    return json_build_object('match_id', null);
  end if;
  flip := random() < 0.5;
  insert into public.matches (white_id, black_id, status, rated, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (case when flip then c.from_id else uid end, case when flip then uid else c.from_id end, 'active', true, now(),
          180, 180000, 180000, now())
  returning * into m;
  update public.challenges set status = 'accepted', responded_at = now(), match_id = m.id where id = c.id;
  update public.matchmaking_queue set last_seen = '-infinity' where user_id in (uid, c.from_id);
  update public.challenges set status = 'cancelled', responded_at = now()
   where status = 'pending' and id <> c.id and (from_id in (uid, c.from_id) or to_id in (uid, c.from_id));
  return json_build_object('match_id', m.id);
end $$;

-- private rooms: same as 0002, the game gets a 3-minute clock when the second player joins
create or replace function public.join_room(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from public.matches where code = upper(trim(p_code)) and status = 'waiting' for update;
  if not found then raise exception 'room not found'; end if;
  if m.white_id = uid then raise exception 'cannot join your own room'; end if;
  update public.matches set black_id = uid, status = 'active', started_at = now(),
         time_control = 180, white_ms = 180000, black_ms = 180000, turn_started_at = now()
   where id = m.id;
  return json_build_object('match_id', m.id);
end $$;

/* ------------------------------------------------------------- view */
-- Same columns as 0003 + the clock (appended at the end). server_now lets the client correct its clock.
create or replace view public.match_view with (security_invoker = true) as
  select m.id,
         case when auth.uid() in (m.white_id, m.black_id) then m.code end as code,
         m.white_id, m.black_id, m.status, m.result, m.result_reason, m.rated, m.move_count, m.created_at,
         wp.username as white_name, wp.rating as white_rating,
         coalesce(bp.username, case when m.vs_bot then 'DAMEO Bot' end) as black_name,
         coalesce(bp.rating, case when m.vs_bot then 1200 end) as black_rating,
         m.vs_bot, m.bot_level,
         m.time_control, m.white_ms, m.black_ms, m.turn_started_at, m.timeout_kind, clock_timestamp() as server_now
  from public.matches m
  join public.profiles wp on wp.id = m.white_id
  left join public.profiles bp on bp.id = m.black_id;

/* ------------------------------------------------------------- sweep */
-- Every 15 s (pg_cron). Skipped where pg_cron is not available (local test database).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('dameo-clock-sweep', '15 seconds', 'select public.finish_expired_games()');
  end if;
end $$;
