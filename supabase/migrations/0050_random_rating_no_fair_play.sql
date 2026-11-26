-- 0050 — Rating: a random 10…25 per game, the same number for both players; fair-play warnings and playbans turned off.
--  * Rating: the winner gets +d, the loser −d, d drawn at random from 10…25 whatever the ratings are. A draw changes nothing.
--    Still in force (apply_match_result, 0046): games under 12 moves change nothing, 5 rated games per pair per day,
--    the floor 100 / virtual ceiling 3000 (zero-sum).
--  * Fair play (0045): no more early-quit counting, no warning, no playban. Existing bans stop working at once.
--    Tables and old rows are kept (nothing deleted); re-enable by restoring the 0045 functions.
--  Existing ratings are not touched; only games finished from now on.

create or replace function public._elo_delta(p_score numeric, p_me int, p_opp int) returns int
language sql volatile set search_path = public as $$
  select case
    when p_score = 1 then 10 + floor(random() * 16)::int       -- +10 … +25
    when p_score = 0 then -(10 + floor(random() * 16)::int)    -- −10 … −25
    else 0 end
$$;
revoke all on function public._elo_delta(numeric, int, int) from public, anon, authenticated;

-- fair play off: nothing is recorded …
create or replace function public._fair_play_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  return new;
end $$;
revoke all on function public._fair_play_note() from public, anon, authenticated;

-- … nobody is blocked from matchmaking …
create or replace function public._playban_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$ select null::timestamptz $$;
revoke all on function public._playban_until(uuid) from public, anon, authenticated;

-- … and the app is never told about a warning or a ban
create or replace function public.fair_play_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('early_24h', 0, 'warned', false, 'warned_at', null, 'ban_until', null, 'ban_minutes', null,
                           'server_now', clock_timestamp())
$$;
revoke all on function public.fair_play_status() from public, anon;
grant execute on function public.fair_play_status() to authenticated;
