-- DAMEO 0031: Daily rating (replaces the weekly tournament on the rating page).
--  * One day = 00:00 → 24:00 Asia/Tashkent. Nobody joins: every rated game that ends that day counts automatically.
--  * Daily points = the sum of the POSITIVE global rating changes (matches.white_delta / black_delta written by
--    apply_match_result) of the player's rated games that day. Losses do not subtract. Elo, apply_match_result and the
--    rating tables are untouched; every rule that already limits Elo (short games, pair limits …) limits points too.
--  * Ranking: more points → reached that score earlier. Only players with points > 0 and not restricted are ranked.
--  * After midnight (+2 min grace) the day's #1 is frozen once into daily_winners (prize: Ayiqcha Gift, 15 ⭐).
--    The scheduler then calls the edge function `daily-winner`, which tells the winner and sends the super admin an
--    audit (Telegram username / id, games, wins …). Delivery state is kept per row, so nobody is messaged twice.
--  * The weekly tournament's scheduler is stopped; its tables and history are kept (nothing is deleted).
-- Additive: one new table + functions.

create table if not exists public.daily_winners (
  day                 date primary key,                     -- Tashkent calendar day
  user_id             uuid not null references public.profiles(id) on delete cascade,
  points              int not null,
  wins                int not null,
  losses              int not null,
  draws               int not null,
  games               int not null,
  pvp_games           int not null,
  virtual_games       int not null,
  opponents           int not null,
  reached_at          timestamptz,
  runner_up           jsonb,                                -- #2 for the admin audit (username, points)
  players             int not null,                         -- ranked players that day
  tg_id               bigint,                               -- snapshot at freeze time
  username            text,
  created_at          timestamptz not null default now(),
  notify_attempts     int not null default 0,
  notify_claimed_at   timestamptz,
  winner_notified_at  timestamptz,
  winner_error        text,
  admin_notified_at   timestamptz
);
alter table public.daily_winners enable row level security;
revoke all on public.daily_winners from anon, authenticated;
grant select, insert, update on public.daily_winners to service_role;

/* ------------------------------------------------------------ day helpers */
create or replace function public._daily_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Tashkent')::date $$;
-- the first day with a prize (the day this feature went live)
create or replace function public._daily_first_day() returns date
language sql immutable set search_path = public as $$ select date '2026-11-12' $$;

-- Every player's numbers for one Tashkent day (both colours, PvP and virtual opponents, rated + applied only).
create or replace function public._daily_live(p_day date)
returns table (user_id uuid, points int, wins int, losses int, draws int, games int, pvp_games int, virtual_games int,
               opponents int, reached_at timestamptz, rank int)
language sql stable security definer set search_path = public as $$
  with b as (select p_day::timestamp at time zone 'Asia/Tashkent' as s, (p_day + 1)::timestamp at time zone 'Asia/Tashkent' as e),
  m as (
    select x.* from public.matches x, b
    where x.status = 'finished' and x.rated and x.rating_applied and x.ended_at >= b.s and x.ended_at < b.e
  ),
  g as (
    select m.white_id as uid, coalesce(m.white_delta, 0) as d, m.ended_at,
           case when m.result = 'draw' then 'd' when m.result = 'white' then 'w' else 'l' end as res,
           m.black_id is null as virt, coalesce(m.black_id::text, 'v:' || m.virtual_id::text, 'bot') as opp
    from m where m.white_id is not null
    union all
    select m.black_id, coalesce(m.black_delta, 0), m.ended_at,
           case when m.result = 'draw' then 'd' when m.result = 'black' then 'w' else 'l' end,
           false, m.white_id::text
    from m where m.black_id is not null
  ),
  a as (
    select g.uid,
           sum(greatest(g.d, 0))::int as points,
           count(*) filter (where g.res = 'w')::int as wins,
           count(*) filter (where g.res = 'l')::int as losses,
           count(*) filter (where g.res = 'd')::int as draws,
           count(*)::int as games,
           count(*) filter (where not g.virt)::int as pvp_games,
           count(*) filter (where g.virt)::int as virtual_games,
           count(distinct g.opp)::int as opponents,
           max(g.ended_at) filter (where g.d > 0) as reached_at
    from g group by g.uid
  )
  select a.uid, a.points, a.wins, a.losses, a.draws, a.games, a.pvp_games, a.virtual_games, a.opponents, a.reached_at,
         case when a.points > 0 and not public._is_banned(a.uid) then
           (row_number() over (order by (a.points > 0 and not public._is_banned(a.uid)) desc, a.points desc,
                                        a.reached_at asc nulls last, a.uid))::int end
  from a;
$$;

/* ------------------------------------------------------------- public API */
-- Everything the "Kunlik" tab needs in one call: top 10, the caller's own place, yesterday's winner, the clock.
create or replace function public.daily_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); d date := public._daily_today(); top json; me json; n int; y json;
begin
  select count(*) into n from public._daily_live(d) l where l.rank is not null;
  select coalesce(json_agg(json_build_object('rank', l.rank, 'user_id', l.user_id, 'username', p.username, 'avatar', p.avatar,
                                             'rating', p.rating, 'points', l.points, 'wins', l.wins, 'losses', l.losses,
                                             'draws', l.draws, 'games', l.games) order by l.rank), '[]'::json)
    into top
    from public._daily_live(d) l join public.profiles p on p.id = l.user_id
   where l.rank between 1 and 10;
  if uid is not null then
    select json_build_object('rank', l.rank, 'points', l.points, 'wins', l.wins, 'losses', l.losses, 'draws', l.draws,
                             'games', l.games, 'username', p.username, 'avatar', p.avatar, 'rating', p.rating)
      into me from public._daily_live(d) l join public.profiles p on p.id = l.user_id where l.user_id = uid;
    if me is null then
      select json_build_object('rank', null, 'points', 0, 'wins', 0, 'losses', 0, 'draws', 0, 'games', 0,
                               'username', p.username, 'avatar', p.avatar, 'rating', p.rating)
        into me from public.profiles p where p.id = uid;
    end if;
  end if;
  -- yesterday: the frozen winner if already frozen, otherwise the live #1 of that day (same rule)
  select json_build_object('day', w.day, 'user_id', w.user_id, 'username', p.username, 'avatar', p.avatar, 'points', w.points,
                           'wins', w.wins, 'games', w.games)
    into y from public.daily_winners w join public.profiles p on p.id = w.user_id where w.day = d - 1;
  if y is null and d - 1 >= public._daily_first_day() then
    select json_build_object('day', d - 1, 'user_id', l.user_id, 'username', p.username, 'avatar', p.avatar, 'points', l.points,
                             'wins', l.wins, 'games', l.games)
      into y from public._daily_live(d - 1) l join public.profiles p on p.id = l.user_id where l.rank = 1;
  end if;
  return json_build_object(
    'day', d,
    'starts_at', d::timestamp at time zone 'Asia/Tashkent',
    'ends_at', (d + 1)::timestamp at time zone 'Asia/Tashkent',
    'players', n,
    'top', top,
    'me', me,
    'yesterday', y,
    'server_now', clock_timestamp());
end $$;

/* ------------------------------------------------------------ scheduler */
-- Freezes the #1 of every finished day (first prize day: 2026-11-12) exactly once, then wakes the notifier.
create or replace function public.daily_tick() returns json
language plpgsql security definer set search_path = public as $$
declare d date; w record; ru jsonb; n int; pending int; frozen int := 0;
begin
  -- a day is final 2 minutes after Tashkent midnight (games finishing on the stroke of midnight are applied by then)
  for d in select gs::date from generate_series(greatest(public._daily_first_day(), public._daily_today() - 3),
                                                 ((now() - interval '2 minutes') at time zone 'Asia/Tashkent')::date - 1,
                                                 interval '1 day') gs
  loop
    continue when exists (select 1 from public.daily_winners where day = d);
    select l.* into w from public._daily_live(d) l where l.rank = 1;
    continue when not found;
    select count(*) into n from public._daily_live(d) l where l.rank is not null;
    select jsonb_build_object('username', p.username, 'points', l.points, 'games', l.games) into ru
      from public._daily_live(d) l join public.profiles p on p.id = l.user_id where l.rank = 2;
    insert into public.daily_winners (day, user_id, points, wins, losses, draws, games, pvp_games, virtual_games, opponents,
                                      reached_at, runner_up, players, tg_id, username)
    select d, w.user_id, w.points, w.wins, w.losses, w.draws, w.games, w.pvp_games, w.virtual_games, w.opponents,
           w.reached_at, ru, n, p.tg_id, p.username
      from public.profiles p where p.id = w.user_id
    on conflict (day) do nothing;
    if found then frozen := frozen + 1; end if;
  end loop;
  select count(*) into pending from public.daily_winners
   where (admin_notified_at is null or (tg_id is not null and winner_notified_at is null and winner_error is null))
     and notify_attempts < 300 and (notify_claimed_at is null or notify_claimed_at < now() - interval '3 minutes');
  if pending > 0 and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_post(url := 'https://reymdxmzfgctdhowndye.supabase.co/functions/v1/daily-winner',
                          body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
  return json_build_object('frozen', frozen, 'pending', pending);
end $$;

-- Edge function side (service_role only): take the rows that still need messages (a claim lasts 3 minutes) …
create or replace function public.daily_notify_claim() returns setof public.daily_winners
language sql security definer set search_path = public as $$
  update public.daily_winners w set notify_claimed_at = now(), notify_attempts = w.notify_attempts + 1
   where w.day in (select x.day from public.daily_winners x
                    where (x.admin_notified_at is null or (x.tg_id is not null and x.winner_notified_at is null and x.winner_error is null))
                      and x.notify_attempts < 300 and (x.notify_claimed_at is null or x.notify_claimed_at < now() - interval '3 minutes')
                    order by x.day for update skip locked)
  returning w.*;
$$;

-- … and record what was delivered.
create or replace function public.daily_notify_done(p_day date, p_winner_ok boolean, p_winner_error text, p_admin_ok boolean)
returns void language sql security definer set search_path = public as $$
  update public.daily_winners set
    winner_notified_at = case when p_winner_ok then coalesce(winner_notified_at, now()) else winner_notified_at end,
    winner_error       = case when p_winner_ok then null else coalesce(nullif(p_winner_error, ''), winner_error) end,
    admin_notified_at  = case when p_admin_ok then coalesce(admin_notified_at, now()) else admin_notified_at end,
    notify_claimed_at  = null
  where day = p_day;
$$;

revoke all on function public._daily_today(), public._daily_first_day(), public._daily_live(date), public.daily_overview(), public.daily_tick(),
  public.daily_notify_claim(), public.daily_notify_done(date, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.daily_overview() to anon, authenticated;
grant execute on function public.daily_tick(), public.daily_notify_claim(), public.daily_notify_done(date, boolean, text, boolean) to service_role;

/* ------------------------------------------------------------ schedule */
-- every 5 minutes: freeze finished days, wake the notifier when something is pending. The weekly tick is stopped.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dameo-daily-tick', '*/5 * * * *', 'select public.daily_tick()');
    if exists (select 1 from cron.job where jobname = 'dameo-weekly-tick') then
      perform cron.unschedule('dameo-weekly-tick');
    end if;
  end if;
end $$;
