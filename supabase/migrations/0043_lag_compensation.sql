-- 0043 — Network lag compensation for the game clocks (slow internet must not eat the player's 30 s).
--  * The app measures how long the player really thought (from the moment the opponent's move appeared on screen to the
--    moment the move was made) and sends it as think_ms. The server measures from the start of the turn to the moment
--    the move reached the server (match-action passes its arrival time). The difference is network delay; up to 3 s of it
--    per move is given back (an app that lies gains at most those 3 s).
--  * Time the server itself spends (edge function + database) after the move arrived is charged to nobody: the mover is
--    charged up to the arrival time, the opponent's turn starts when the move is stored.
--  * Grace after a deadline: 1 s → 2 s. Nobody is flagged before deadline + 3 s + 2 s, so a move that is still on its
--    way cannot lose on time.
-- Additive: new function clock_take_turn_lag; the old clock_take_turn(uuid,int) stays (no compensation) for old callers.

create or replace function public._clock_grace() returns interval
language sql immutable set search_path = public as $$ select interval '2 seconds' $$;

create or replace function public._lag_comp_max_ms() returns int
language sql immutable set search_path = public as $$ select 3000 $$;

create or replace function public.clock_take_turn_lag(p_match uuid, p_ply int, p_think_ms int default null, p_at timestamptz default null)
returns json
language plpgsql security definer set search_path = public as $$
declare m public.matches; d record; t timestamptz := clock_timestamp(); arr timestamptz; srv int; comp int := 0;
        used int; lim int; wms int; bms int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then return json_build_object('ok', false, 'error', 'not-active'); end if;
  if m.move_count <> p_ply then return json_build_object('ok', false, 'error', 'conflict'); end if;
  if m.time_control is null or m.turn_started_at is null then           -- untimed game: only claim the ply
    update public.matches set move_count = p_ply + 1 where id = m.id;
    return json_build_object('ok', true);
  end if;
  d := public._clock_deadline(m);
  -- when the move reached the server (edge arrival time), never in the future, never more than 20 s back
  arr := least(t, greatest(coalesce(p_at, t), t - interval '20 seconds', m.turn_started_at));
  srv := greatest(0, round(extract(epoch from (arr - m.turn_started_at)) * 1000))::int;
  if p_think_ms is not null then
    comp := least(public._lag_comp_max_ms(), greatest(0, srv - greatest(0, p_think_ms)));
  end if;
  used := srv - comp;
  lim := round(extract(epoch from (d.deadline - m.turn_started_at)) * 1000)::int;
  if used > lim + round(extract(epoch from public._clock_grace()) * 1000)::int then
    perform public._flag_impl(m.id, true);
    return json_build_object('ok', false, 'error', 'timeout');
  end if;
  used := least(used, lim);                                               -- never below zero on the clock
  wms := m.white_ms; bms := m.black_ms;
  if p_ply > 0 then                                                       -- White's first move is free
    if d.side = 'w' then wms := greatest(0, wms - used); else bms := greatest(0, bms - used); end if;
  end if;
  update public.matches set move_count = p_ply + 1, white_ms = wms, black_ms = bms, turn_started_at = t where id = m.id;
  return json_build_object('ok', true, 'white_ms', wms, 'black_ms', bms, 'turn_started_at', t, 'lag_ms', comp);
end $$;

revoke all on function public.clock_take_turn_lag(uuid, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.clock_take_turn_lag(uuid, int, int, timestamptz) to service_role;
revoke all on function public._lag_comp_max_ms() from public, anon, authenticated;

-- A turn is lost on time only after deadline + 3 s (lag) + 2 s (grace): a move still in flight can always arrive.
-- p_late: the server already judged an arrived move too late (clock_take_turn*) → end the game now.
create or replace function public._flag_impl(p_match uuid, p_late boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.matches; d record;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' or m.time_control is null or m.turn_started_at is null then return false; end if;
  d := public._clock_deadline(m);
  if m.virtual_id is not null and d.side = 'b' and m.bot_pending is not null then
    perform public.virtual_commit(m.id);
    return false;
  end if;
  if not p_late and clock_timestamp() <= d.deadline + public._clock_grace() + public._lag_comp_max_ms() * interval '1 millisecond' then return false; end if;
  update public.matches
     set status = 'finished', result = case when d.side = 'w' then 'black' else 'white' end, result_reason = 'resign',
         timeout_kind = d.kind, ended_at = now(),
         white_ms = case when d.side = 'w' and d.kind = 'clock' then 0 else white_ms end,
         black_ms = case when d.side = 'b' and d.kind = 'clock' then 0 else black_ms end,
         bot_pending = null, bot_due_at = null
   where id = m.id;
  if m.rated then perform public.apply_match_result(m.id); end if;
  return true;
end $$;
revoke all on function public._flag_impl(uuid, boolean) from public, anon, authenticated;

create or replace function public._flag(p_match uuid) returns boolean
language sql security definer set search_path = public as $$ select public._flag_impl(p_match, false) $$;

-- the old entry point (no compensation) keeps working for old callers; a late move ends the game at once
create or replace function public.clock_take_turn(p_match uuid, p_ply int) returns json
language sql security definer set search_path = public as $$ select public.clock_take_turn_lag(p_match, p_ply, null, null) $$;

create or replace function public.finish_expired_games() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- 1. virtual games: planned bot moves whose time has come (the player's app may be in the background)
  for r in select id from public.matches
            where status = 'active' and bot_pending is not null and bot_due_at < now() - interval '2 seconds' loop
    if coalesce((public.virtual_commit(r.id) ->> 'ok')::boolean, false) then n := n + 1; end if;
  end loop;
  -- 2. timed games out of time (30 s + 3 s lag + 2 s grace)
  for r in select id from public.matches
            where status = 'active' and time_control is not null and turn_started_at < now() - interval '35 seconds' loop
    if public._flag(r.id) then n := n + 1; end if;
  end loop;
  -- 3. untimed games left behind
  n := n + public._close_abandoned_untimed();
  return n;
end $$;
