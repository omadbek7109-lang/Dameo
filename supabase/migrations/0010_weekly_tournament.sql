-- DAMEO 0010: DAMEO Weekly Tournament.
--
-- * One tournament per week (Asia/Tashkent): Monday 00:00 → Sunday 23:59:59 (ends_at = next Monday 00:00, exclusive).
-- * No separate scoring: a participant's tournament score is the sum of the GLOBAL rating changes (matches.white_delta /
--   black_delta, written once by apply_match_result) of their rated player-vs-player games that ended between joining
--   and the end of the week. So start_rating + score = their global rating during the week, and the Elo / ±5 logic,
--   apply_match_result and the rating tables are not touched. Bot games are excluded explicitly (they are unrated anyway).
-- * Each game is one matches row → counted at most once per player; rating_applied guarantees the delta is final.
-- * When the week ends the standings are frozen into weekly_entries.final_* (once, idempotent) and never change again.
-- * A pg_cron job (every minute) finalizes ended weeks and creates the current week; weekly_overview() does the same
--   lazily, so the schedule keeps working even if cron is late. Clients can only call weekly_join(); all other writes are
--   server-side (no INSERT/UPDATE grants, RLS read-only).
-- Additive only: two new tables + functions. Existing tables, ratings and the old tournaments feature are unchanged.

create table if not exists public.weekly_tournaments (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null unique,                         -- Monday of the week (Asia/Tashkent)
  name         text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'finished')),
  finalized_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint weekly_period check (ends_at > starts_at)
);

create table if not exists public.weekly_entries (
  tournament_id    uuid not null references public.weekly_tournaments(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  start_rating     int not null,                             -- global rating when the player joined
  -- frozen results (null while the week is running)
  final_rank       int,
  final_delta      int,
  final_rating     int,
  final_wins       int,
  final_losses     int,
  final_draws      int,
  final_games      int,
  final_reached_at timestamptz,
  primary key (tournament_id, user_id)
);
create index if not exists weekly_entries_user_idx on public.weekly_entries (user_id);
create index if not exists matches_ended_idx on public.matches (ended_at) where status = 'finished';

alter table public.weekly_tournaments enable row level security;
alter table public.weekly_entries enable row level security;
create policy weekly_tournaments_read on public.weekly_tournaments for select to anon, authenticated using (true);
create policy weekly_entries_read on public.weekly_entries for select to anon, authenticated using (true);
revoke all on public.weekly_tournaments, public.weekly_entries from anon, authenticated;
grant select on public.weekly_tournaments, public.weekly_entries to anon, authenticated;
grant select, insert, update on public.weekly_tournaments, public.weekly_entries to service_role;

/* --------------------------------------------------------------- week helpers */
create or replace function public._weekly_bounds(p_at timestamptz, out week_start date, out starts_at timestamptz, out ends_at timestamptz)
language sql immutable set search_path = public as $$
  select d, d::timestamp at time zone 'Asia/Tashkent', (d + 7)::timestamp at time zone 'Asia/Tashkent'
  from (select date_trunc('week', p_at at time zone 'Asia/Tashkent')::date as d) w;
$$;

-- The current week's tournament (created on first use; the unique week_start makes this race-safe).
create or replace function public._weekly_ensure() returns public.weekly_tournaments
language plpgsql security definer set search_path = public as $$
declare b record; t public.weekly_tournaments;
begin
  b := public._weekly_bounds(now());
  insert into public.weekly_tournaments (week_start, name, starts_at, ends_at)
  values (b.week_start, 'DAMEO Weekly ' || to_char(b.week_start, 'IYYY "#"IW'), b.starts_at, b.ends_at)
  on conflict (week_start) do nothing;
  select * into t from public.weekly_tournaments where week_start = b.week_start;
  return t;
end $$;

/* ------------------------------------------------------------ live standings */
-- Score = sum of global rating deltas of counted games. Ranked players: at least one counted game.
-- Tie-break: more points → more wins → fewer losses → reached the score earlier → joined earlier.
create or replace function public._weekly_live(p_tournament uuid)
returns table (user_id uuid, start_rating int, joined_at timestamptz, delta int, wins int, losses int, draws int,
               games int, reached_at timestamptz, rank int)
language sql stable security definer set search_path = public as $$
  with t as (select * from public.weekly_tournaments where id = p_tournament),
  g as (
    select e.user_id, e.start_rating, e.joined_at,
           coalesce(sum(x.d), 0)::int as delta,
           count(*) filter (where x.res = 'w')::int as wins,
           count(*) filter (where x.res = 'l')::int as losses,
           count(*) filter (where x.res = 'd')::int as draws,
           count(x.d)::int as games,
           max(x.ended_at) filter (where x.d <> 0) as reached_at
    from public.weekly_entries e
    cross join t
    left join lateral (
      select m.ended_at,
             case when m.white_id = e.user_id then m.white_delta else m.black_delta end as d,
             case when m.result = 'draw' then 'd'
                  when (m.result = 'white') = (m.white_id = e.user_id) then 'w' else 'l' end as res
      from public.matches m
      where (m.white_id = e.user_id or m.black_id = e.user_id)
        and m.status = 'finished' and m.rated and m.rating_applied
        and not m.vs_bot and m.black_id is not null                       -- player vs player only
        and m.ended_at >= greatest(e.joined_at, t.starts_at) and m.ended_at < t.ends_at
    ) x on true
    where e.tournament_id = p_tournament
    group by e.user_id, e.start_rating, e.joined_at
  )
  select g.*, case when g.games > 0 then
           (row_number() over (order by (g.games > 0) desc, g.delta desc, g.wins desc, g.losses asc,
                                        g.reached_at asc nulls last, g.joined_at asc, g.user_id))::int end
  from g;
$$;

/* ------------------------------------------------------------------- freeze */
-- Freezes an ended week exactly once. Later games / rating changes never touch frozen rows.
create or replace function public._weekly_finalize(p_tournament uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare t public.weekly_tournaments;
begin
  select * into t from public.weekly_tournaments where id = p_tournament for update;
  if not found or t.status <> 'active' or now() < t.ends_at then return false; end if;
  update public.weekly_entries e
     set final_rank = l.rank, final_delta = l.delta, final_rating = l.start_rating + l.delta,
         final_wins = l.wins, final_losses = l.losses, final_draws = l.draws, final_games = l.games,
         final_reached_at = l.reached_at
    from public._weekly_live(t.id) l
   where e.tournament_id = t.id and e.user_id = l.user_id;
  update public.weekly_tournaments set status = 'finished', finalized_at = now() where id = t.id;
  return true;
end $$;

-- Scheduler entry point (pg_cron, every minute): freeze ended weeks, make sure the current week exists.
create or replace function public.weekly_tick() returns json
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; cur public.weekly_tournaments;
begin
  for r in select id from public.weekly_tournaments where status = 'active' and ends_at <= now() order by ends_at loop
    if public._weekly_finalize(r.id) then n := n + 1; end if;
  end loop;
  cur := public._weekly_ensure();
  return json_build_object('finalized', n, 'current', cur.id);
end $$;

/* ------------------------------------------------------------- public API */
-- Everything the tournament page needs in one call (public; the caller's own entry when signed in).
create or replace function public.weekly_overview() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur public.weekly_tournaments; prev public.weekly_tournaments; me json; winners json; n int;
begin
  perform public.weekly_tick();
  select * into cur from public.weekly_tournaments where week_start = (public._weekly_bounds(now())).week_start;
  select count(*) into n from public.weekly_entries where tournament_id = cur.id;
  if uid is not null then
    select json_build_object('joined', true, 'start_rating', l.start_rating, 'delta', l.delta, 'wins', l.wins,
                             'losses', l.losses, 'draws', l.draws, 'games', l.games, 'rank', l.rank, 'joined_at', l.joined_at)
      into me from public._weekly_live(cur.id) l where l.user_id = uid;
  end if;
  select * into prev from public.weekly_tournaments where status = 'finished' order by ends_at desc limit 1;
  if found then
    select coalesce(json_agg(json_build_object('rank', e.final_rank, 'user_id', e.user_id, 'username', p.username,
                                               'avatar', p.avatar, 'delta', e.final_delta, 'rating', e.final_rating,
                                               'wins', e.final_wins, 'losses', e.final_losses, 'games', e.final_games)
                             order by e.final_rank), '[]'::json)
      into winners
      from public.weekly_entries e join public.profiles p on p.id = e.user_id
     where e.tournament_id = prev.id and e.final_rank between 1 and 5;
  end if;
  return json_build_object(
    'current', json_build_object('id', cur.id, 'name', cur.name, 'week_start', cur.week_start, 'starts_at', cur.starts_at,
                                 'ends_at', cur.ends_at, 'status', cur.status, 'participants', n),
    'me', coalesce(me, json_build_object('joined', false)),
    'previous', case when prev.id is null then null else
                  json_build_object('id', prev.id, 'name', prev.name, 'starts_at', prev.starts_at, 'ends_at', prev.ends_at,
                                    'winners', winners) end,
    'next_starts_at', cur.ends_at,
    'server_now', clock_timestamp());
end $$;

-- Standings of a tournament (current week when null): live while running, frozen once finished. Public.
create or replace function public.weekly_standings(p_tournament uuid default null, p_limit int default 100)
returns table (rank int, user_id uuid, username text, avatar text, rating int, start_rating int, delta int,
               wins int, losses int, draws int, games int, joined_at timestamptz, frozen boolean)
language plpgsql security definer set search_path = public as $$
declare t public.weekly_tournaments;
begin
  if p_tournament is null then
    t := public._weekly_ensure();
  else
    select * into t from public.weekly_tournaments where id = p_tournament;
    if not found then return; end if;
    if t.status = 'active' and now() >= t.ends_at then perform public._weekly_finalize(t.id); select * into t from public.weekly_tournaments where id = t.id; end if;
  end if;
  if t.status = 'finished' then
    return query
      select e.final_rank, e.user_id, p.username, p.avatar, e.final_rating, e.start_rating, e.final_delta,
             e.final_wins, e.final_losses, e.final_draws, e.final_games, e.joined_at, true
      from public.weekly_entries e join public.profiles p on p.id = e.user_id
      where e.tournament_id = t.id
      order by e.final_rank asc nulls last, e.joined_at
      limit greatest(1, least(p_limit, 500));
  else
    return query
      select l.rank, l.user_id, p.username, p.avatar, l.start_rating + l.delta, l.start_rating, l.delta,
             l.wins, l.losses, l.draws, l.games, l.joined_at, false
      from public._weekly_live(t.id) l join public.profiles p on p.id = l.user_id
      order by l.rank asc nulls last, l.joined_at
      limit greatest(1, least(p_limit, 500));
  end if;
end $$;

-- Join the current week. The rating at this moment is the starting value; only games that end after joining count.
create or replace function public.weekly_join() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.weekly_tournaments; r int; e public.weekly_entries;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform public.weekly_tick();
  t := public._weekly_ensure();
  if t.status <> 'active' or now() >= t.ends_at then raise exception 'tournament finished'; end if;
  select rating into r from public.profiles where id = uid;
  if not found then raise exception 'profile not found'; end if;
  insert into public.weekly_entries (tournament_id, user_id, joined_at, start_rating) values (t.id, uid, now(), r)
  on conflict (tournament_id, user_id) do nothing;
  select * into e from public.weekly_entries where tournament_id = t.id and user_id = uid;
  return json_build_object('tournament_id', t.id, 'joined_at', e.joined_at, 'start_rating', e.start_rating);
end $$;

revoke all on function public._weekly_bounds(timestamptz), public._weekly_ensure(), public._weekly_live(uuid),
  public._weekly_finalize(uuid), public.weekly_tick(), public.weekly_overview(), public.weekly_standings(uuid, int),
  public.weekly_join() from public, anon, authenticated;
grant execute on function public.weekly_tick() to service_role;
grant execute on function public.weekly_overview(), public.weekly_standings(uuid, int) to anon, authenticated;
grant execute on function public.weekly_join() to authenticated;

/* ------------------------------------------------------------ scheduler */
-- Every minute: freeze ended weeks, open the new one. Skipped where pg_cron is not available (local tests).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dameo-weekly-tick', '* * * * *', 'select public.weekly_tick()');
  end if;
end $$;
