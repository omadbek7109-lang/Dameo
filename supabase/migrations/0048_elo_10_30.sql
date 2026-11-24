-- 0048 — Elo points kept between 10 and 30 for a decided game (owner's rule).
--  equal ratings ±20; the stronger player wins → at least +10 (instead of +1); a big upset → at most ±30 (instead of 40).
--  Draws unchanged (Elo, at most ±10). Still one number for both players (winner +d, loser −d); the floor 100 still
--  keeps it zero-sum (someone at 100 can't lose more, so beating them gives that little). Existing ratings untouched.
create or replace function public._elo_delta(p_score numeric, p_me int, p_opp int) returns int
language sql immutable set search_path = public as $$
  select case
    when p_score = 1 then least(30, greatest(10, round(40 * (1 - e))::int))
    when p_score = 0 then greatest(-30, least(-10, round(-40 * e)::int))
    else greatest(-10, least(10, round(40 * (0.5 - e))::int)) end
  from (select 1 / (1 + power(10::numeric, (coalesce(p_opp, 1200) - p_me) / 400.0)) as e) x
$$;
revoke all on function public._elo_delta(numeric, int, int) from public, anon, authenticated;
