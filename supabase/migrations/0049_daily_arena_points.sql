-- 0049 — Daily rating gets its own points (Lichess "Arena" style), separate from the Elo rating. From 2026-11-25.
--  * A rated game that ends that day: win 2, draw 1, loss 0 — against real players and virtual players alike.
--  * A game under 12 moves gives nothing (same rule as the rating).
--  * Only the first 5 games against the same opponent that day count (a virtual player is one opponent too).
--  * Ranking: more points → bigger rating change that day → reached that score earlier. Only points > 0, not restricted.
--  * Days before 2026-11-25 keep the old rule (sum of positive rating changes), so frozen history and yesterday's
--    card stay as they were. daily_winners, the freeze, the prize and the notifications are unchanged.
create or replace function public._daily_live(p_day date)
returns table (user_id uuid, points integer, wins integer, losses integer, draws integer, games integer, pvp_games integer,
               virtual_games integer, opponents integer, reached_at timestamptz, rank integer)
language sql stable security definer set search_path = public as $$
  with b as (select p_day::timestamp at time zone 'Asia/Tashkent' as s, (p_day + 1)::timestamp at time zone 'Asia/Tashkent' as e,
                    p_day >= date '2026-11-25' as arena),
  m as (
    select x.* from public.matches x, b
    where x.status = 'finished' and x.rated and x.rating_applied and x.ended_at >= b.s and x.ended_at < b.e
  ),
  g0 as (
    select m.white_id as uid, coalesce(m.white_delta, 0) as d, m.ended_at, coalesce(m.move_count, 0) as moves,
           case when m.result = 'draw' then 'd' when m.result = 'white' then 'w' else 'l' end as res,
           m.black_id is null as virt, coalesce(m.black_id::text, 'v:' || m.virtual_id::text, 'bot') as opp
    from m where m.white_id is not null
    union all
    select m.black_id, coalesce(m.black_delta, 0), m.ended_at, coalesce(m.move_count, 0),
           case when m.result = 'draw' then 'd' when m.result = 'black' then 'w' else 'l' end,
           false, m.white_id::text
    from m where m.black_id is not null
  ),
  g as (
    select g0.*,
           case when (select arena from b) then
             case when g0.moves < 12 or row_number() over (partition by g0.uid, g0.opp order by g0.ended_at) > 5 then 0
                  when g0.res = 'w' then 2 when g0.res = 'd' then 1 else 0 end
           else greatest(g0.d, 0) end as pts
    from g0
  ),
  a as (
    select g.uid,
           sum(g.pts)::int as points,
           sum(g.d)::int as net,
           count(*) filter (where g.res = 'w')::int as wins,
           count(*) filter (where g.res = 'l')::int as losses,
           count(*) filter (where g.res = 'd')::int as draws,
           count(*)::int as games,
           count(*) filter (where not g.virt)::int as pvp_games,
           count(*) filter (where g.virt)::int as virtual_games,
           count(distinct g.opp)::int as opponents,
           max(g.ended_at) filter (where g.pts > 0) as reached_at
    from g group by g.uid
  )
  select a.uid, a.points, a.wins, a.losses, a.draws, a.games, a.pvp_games, a.virtual_games, a.opponents, a.reached_at,
         case when a.points > 0 and not public._is_banned(a.uid) then
           (row_number() over (order by (a.points > 0 and not public._is_banned(a.uid)) desc, a.points desc,
                                        case when (select arena from b) then a.net end desc nulls last,
                                        a.reached_at asc nulls last, a.uid))::int end
  from a;
$$;
revoke all on function public._daily_live(date) from public, anon, authenticated;
