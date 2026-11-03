-- DAMEO 0017: virtual opponents (AI players with their own profile), stuck-game cleanup, honest live list.
--
-- Virtual opponents
--   * 10 profiles in their own table (NOT auth users, NOT in profiles / the leaderboard): nickname, own artwork avatar,
--     style, strength level, their own rating and W/L/D. They are always shown with an "AI" badge in the app.
--   * A player who searches for an opponent and finds nobody gets one after a random 20–35 s (the client asks
--     virtual_match; the server checks the player really has been searching ≥ 18 s). The 60 s search itself is unchanged.
--   * The game runs on the existing server bot engine (match-action Edge Function) with clocks on both sides:
--     the server plans the bot's move AND its thinking time, stores it as bot_pending, and commits it when it is due
--     (virtual_commit: the client asks at the due time, the 15 s sweep commits it if the client is gone).
--     The bot's clock is charged with the planned thinking time, so it can lose on time like anyone else.
--   * Virtual games are unrated (like all bot games): they never change a real player's rating, stats or weekly result.
--   * Admin: global on/off, auto-off when enough real players are online, per-bot on/off and strength.
--
-- Cleanup
--   * Untimed games nobody touched for 30 minutes (the player left) are closed by the sweep: never-started ones are
--     aborted, started games against the old bot count as abandoned (bot wins, unrated), untimed PvP leftovers are aborted.
--   * The live list shows only running timed games between real players or against a virtual opponent.
-- Additive: new tables / nullable columns / functions; existing data is kept (old games are only closed, never deleted).

/* ================================================================= virtual players */
create table if not exists public.virtual_players (
  id         uuid primary key default gen_random_uuid(),
  nickname   text not null unique check (length(nickname) between 2 and 24),
  avatar     text not null check (avatar ~ '^https://'),
  gender     text not null check (gender in ('f', 'm', 'x')),
  style      text not null check (style in ('aggressive', 'solid', 'tricky', 'calm', 'fast')),
  level      text not null check (level in ('beginner', 'normal', 'pro')),
  rating     int  not null default 1200 check (rating between 100 and 3000),
  wins       int  not null default 0,
  losses     int  not null default 0,
  draws      int  not null default 0,
  enabled    boolean not null default true,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.virtual_players enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'virtual_players' and policyname = 'virtual_players_read') then
    create policy virtual_players_read on public.virtual_players for select to anon, authenticated using (true);
  end if;
end $$;
grant select on public.virtual_players to anon, authenticated;

-- one settings row
create table if not exists public.virtual_settings (
  id                 boolean primary key default true check (id),
  enabled            boolean not null default true,
  auto_off           boolean not null default false,
  auto_off_threshold int     not null default 30 check (auto_off_threshold between 1 and 100000),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null
);
alter table public.virtual_settings enable row level security;
insert into public.virtual_settings (id) values (true) on conflict (id) do nothing;

do $$
declare base text := 'https://omadbek7109-lang.github.io/Dameo/docs/vp/';
begin
  insert into public.virtual_players (nickname, avatar, gender, style, level, rating, sort) values
    ('Madina',   base || 'madina.svg',   'f', 'solid',      'normal',   1235, 1),
    ('Aylin',    base || 'aylin.svg',    'f', 'fast',       'beginner', 1120, 2),
    ('Shaxnoza', base || 'shaxnoza.svg', 'f', 'calm',       'pro',      1390, 3),
    ('Milana',   base || 'milana.svg',   'f', 'tricky',     'normal',   1260, 4),
    ('Bekzod',   base || 'bekzod.svg',   'm', 'aggressive', 'pro',      1420, 5),
    ('Mirzo',    base || 'mirzo.svg',    'm', 'fast',       'beginner', 1085, 6),
    ('DarkSoul', base || 'darksoul.svg', 'x', 'aggressive', 'pro',      1455, 7),
    ('MrNobody', base || 'mrnobody.svg', 'x', 'calm',       'normal',   1205, 8),
    ('just_me',  base || 'just_me.svg',  'x', 'tricky',     'beginner', 1140, 9),
    ('Silent',   base || 'silent.svg',   'x', 'solid',      'normal',   1290, 10)
  on conflict (nickname) do nothing;
end $$;

/* ================================================================= matches: virtual opponent + planned bot move */
alter table public.matches add column if not exists virtual_id uuid references public.virtual_players(id) on delete set null;
-- the bot's next move, planned by the server: {"ply":n,"from":a,"path":[..],"think":ms}; committed when due
alter table public.matches add column if not exists bot_pending jsonb;
alter table public.matches add column if not exists bot_due_at timestamptz;
-- the virtual opponent's answer to a rematch offer ('declined' or the new match id)
alter table public.matches add column if not exists virtual_rematch text;
create index if not exists matches_bot_due_idx on public.matches (bot_due_at) where status = 'active' and bot_pending is not null;
create index if not exists matches_virtual_idx on public.matches (white_id, created_at desc) where virtual_id is not null;

-- are virtual opponents available right now? (admin switch + optional auto-off when enough real players are online)
create or replace function public._virtual_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled and not (s.auto_off and
                     (select count(*) from public.profiles p where p.last_seen > now() - interval '5 minutes') > s.auto_off_threshold)
                   from public.virtual_settings s where s.id), false);
$$;

-- A searching player gets a virtual opponent (the client calls this at a random moment 20–35 s into the search).
create or replace function public.virtual_match(p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q public.matchmaking_queue; me public.profiles; v public.virtual_players; m public.matches; prev record; existing uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (60, 180, 300) then raise exception 'bad time control'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  -- paired with a real player in the meantime → that game wins
  select id into existing from public.matches
   where status = 'active' and not vs_bot and uid in (white_id, black_id) and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if existing is not null then return json_build_object('match_id', existing, 'virtual', null); end if;
  if not public._virtual_active() then return json_build_object('match_id', null, 'reason', 'disabled'); end if;
  select * into q from public.matchmaking_queue where user_id = uid for update;
  if not found or q.last_seen < now() - interval '20 seconds' or q.time_control <> p_time then
    return json_build_object('match_id', null, 'reason', 'not-searching');
  end if;
  if q.created_at > now() - interval '18 seconds' then return json_build_object('match_id', null, 'reason', 'too-early'); end if;
  select * into me from public.profiles where id = uid;
  -- random enabled opponent, not one of the last 3 this player met, closer ratings a bit more likely
  select * into v from public.virtual_players vp
   where vp.enabled and vp.id not in (select x.virtual_id from public.matches x where x.white_id = uid and x.virtual_id is not null
                                        order by x.created_at desc limit 3)
   order by random() * (1 + abs(vp.rating - me.rating) / 250.0) limit 1;
  if not found then
    select * into v from public.virtual_players vp where vp.enabled order by random() limit 1;
  end if;
  if not found then return json_build_object('match_id', null, 'reason', 'disabled'); end if;
  update public.matchmaking_queue set last_seen = '-infinity' where user_id = uid;
  -- one live bot game per player (same rule as start_bot_match)
  for prev in select id, move_count from public.matches where white_id = uid and vs_bot and status = 'active' for update loop
    if prev.move_count > 0 then
      update public.matches set status = 'finished', result = 'black', result_reason = 'resign', ended_at = now(), bot_pending = null, bot_due_at = null where id = prev.id;
    else
      update public.matches set status = 'aborted', ended_at = now(), bot_pending = null, bot_due_at = null where id = prev.id;
    end if;
  end loop;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, virtual_id, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (uid, 'active', false, true, case v.level when 'beginner' then 'easy' when 'pro' then 'hard' else 'medium' end, v.id, now(),
          p_time, p_time * 1000, p_time * 1000, now())
  returning * into m;
  return json_build_object('match_id', m.id, 'virtual', json_build_object('id', v.id, 'nickname', v.nickname, 'avatar', v.avatar,
                           'rating', v.rating, 'level', v.level, 'style', v.style, 'wins', v.wins, 'losses', v.losses, 'draws', v.draws));
end $$;

-- Commits the planned bot move of a virtual game (service role: match-action at the due time, or the sweep).
-- Charges exactly the planned thinking time to the bot's clock; not enough time left → the bot loses on time.
create or replace function public.virtual_commit(p_match uuid, p_ply int default null) returns json
language plpgsql security definer set search_path = public as $$
declare m public.matches; p jsonb; think int; bms int; t timestamptz := clock_timestamp(); ply int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then return json_build_object('ok', false, 'error', 'not-active'); end if;
  p := m.bot_pending;
  if m.virtual_id is null or p is null then return json_build_object('ok', false, 'error', 'conflict'); end if;
  ply := (p->>'ply')::int;
  if m.move_count <> ply or (p_ply is not null and p_ply <> ply) then return json_build_object('ok', false, 'error', 'conflict'); end if;
  think := greatest(0, coalesce((p->>'think')::int, 0));
  if think > 30000 or m.black_ms is null or think > m.black_ms then
    update public.matches
       set status = 'finished', result = 'white', result_reason = 'resign', ended_at = now(),
           timeout_kind = case when think > 30000 then 'move' else 'clock' end,
           black_ms = case when think > 30000 then black_ms else 0 end, bot_pending = null, bot_due_at = null
     where id = m.id;
    return json_build_object('ok', false, 'error', 'timeout');
  end if;
  insert into public.match_moves (match_id, ply, from_sq, path)
  values (m.id, ply, (p->>'from')::int, array(select jsonb_array_elements_text(p->'path')::int));
  bms := m.black_ms - think;
  update public.matches set move_count = ply + 1, black_ms = bms, turn_started_at = t, bot_pending = null, bot_due_at = null where id = m.id;
  return json_build_object('ok', true, 'ply', ply, 'from', (p->>'from')::int, 'path', p->'path',
                           'white_ms', m.white_ms, 'black_ms', bms, 'turn_started_at', t);
end $$;

/* ================================================================= timeouts + sweep */
-- _flag (0008) + virtual games: when it is the bot's turn the server owns its move → commit it instead of flagging.
create or replace function public._flag(p_match uuid) returns boolean
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
  if clock_timestamp() <= d.deadline + public._clock_grace() then return false; end if;
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

-- untimed games left behind (nobody moved for 30 minutes): close them so they don't hang around as "active"
create or replace function public._close_abandoned_untimed() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select m.id, m.move_count, m.vs_bot from public.matches m
     where m.status = 'active' and m.time_control is null
       and greatest(coalesce(m.started_at, m.created_at),
                    coalesce((select max(mm.created_at) from public.match_moves mm where mm.match_id = m.id), m.created_at))
           < now() - interval '30 minutes'
     for update skip locked
  loop
    if r.vs_bot and r.move_count > 0 then
      -- the player walked away from a bot game: counts as abandoned (bot games are unrated, nothing else changes)
      update public.matches set status = 'finished', result = 'black', result_reason = 'resign', ended_at = now() where id = r.id;
    else
      update public.matches set status = 'aborted', ended_at = now() where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.finish_expired_games() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- 1. virtual games: planned bot moves whose time has come (the player's app may be in the background)
  for r in select id from public.matches
            where status = 'active' and bot_pending is not null and bot_due_at < now() - interval '2 seconds' loop
    if coalesce((public.virtual_commit(r.id) ->> 'ok')::boolean, false) then n := n + 1; end if;
  end loop;
  -- 2. timed games out of time (0008)
  for r in select id from public.matches
            where status = 'active' and time_control is not null and turn_started_at < now() - interval '31 seconds' loop
    if public._flag(r.id) then n := n + 1; end if;
  end loop;
  -- 3. untimed games left behind
  n := n + public._close_abandoned_untimed();
  return n;
end $$;

/* ================================================================= stats of the virtual players */
create or replace function public._virtual_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.virtual_id is not null and old.status = 'active' and new.status = 'finished' then
    update public.virtual_players
       set wins   = wins   + (new.result = 'black')::int,
           losses = losses + (new.result = 'white')::int,
           draws  = draws  + (new.result = 'draw')::int,
           rating = greatest(100, least(3000, rating + case new.result when 'black' then 5 when 'white' then -5 else 0 end))
     where id = new.virtual_id;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_virtual_stats' and tgrelid = 'public.matches'::regclass) then
    create trigger matches_virtual_stats after update of status on public.matches for each row execute function public._virtual_stats();
  end if;
end $$;

/* ================================================================= rematch with a virtual opponent */
-- The opponent answers once per game (sometimes yes, sometimes no); the answer is stored so asking again changes nothing.
create or replace function public.virtual_rematch(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; v public.virtual_players; streak int; chance float; nm public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from public.matches where id = p_match for update;
  if not found or m.white_id <> uid or m.virtual_id is null then raise exception 'match not found'; end if;
  if m.status <> 'finished' then raise exception 'game not finished'; end if;
  if m.virtual_rematch is not null then
    return json_build_object('accepted', m.virtual_rematch <> 'declined',
                             'match_id', case when m.virtual_rematch <> 'declined' then m.virtual_rematch end);
  end if;
  select * into v from public.virtual_players where id = m.virtual_id;
  -- how many games in a row against this player already
  select count(*) into streak from (
    select x.virtual_id from public.matches x where x.white_id = uid and x.virtual_id is not null order by x.created_at desc limit 4) s
   where s.virtual_id = m.virtual_id;
  chance := case m.result when 'white' then 0.72 when 'black' then 0.55 else 0.62 end;   -- losers want revenge more often
  if streak >= 3 then chance := chance - 0.3; end if;
  if not v.enabled or not public._virtual_active() or m.time_control is null or random() >= chance then
    update public.matches set virtual_rematch = 'declined' where id = m.id;
    return json_build_object('accepted', false);
  end if;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, virtual_id, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (uid, 'active', false, true, m.bot_level, m.virtual_id, now(), m.time_control, m.time_control * 1000, m.time_control * 1000, now())
  returning * into nm;
  update public.matches set virtual_rematch = nm.id::text where id = m.id;
  return json_build_object('accepted', true, 'match_id', nm.id);
end $$;

/* ================================================================= reads: match view, live list, archive */
create or replace view public.match_view with (security_invoker = true) as
  select m.id,
         case when auth.uid() in (m.white_id, m.black_id) then m.code end as code,
         m.white_id, m.black_id, m.status, m.result, m.result_reason, m.rated, m.move_count, m.created_at,
         wp.username as white_name, wp.rating as white_rating,
         coalesce(bp.username, vp.nickname, case when m.vs_bot then 'DAMEO Bot' end) as black_name,
         coalesce(bp.rating, vp.rating, case when m.vs_bot then 1200 end) as black_rating,
         m.vs_bot, m.bot_level,
         m.time_control, m.white_ms, m.black_ms, m.turn_started_at, m.timeout_kind, clock_timestamp() as server_now,
         m.is_public,
         m.virtual_id, vp.avatar as virtual_avatar, vp.level as virtual_level, vp.style as virtual_style, m.bot_due_at, m.virtual_rematch
  from public.matches m
  join public.profiles wp on wp.id = m.white_id
  left join public.profiles bp on bp.id = m.black_id
  left join public.virtual_players vp on vp.id = m.virtual_id;

-- what counts as "live": running, public, timed, between real players or against a virtual opponent (not the old bot)
create or replace function public._is_live(m public.matches) returns boolean
language sql stable set search_path = public as $$
  select m.status = 'active' and m.is_public and m.time_control is not null and (not m.vs_bot or m.virtual_id is not null)
     and coalesce(m.turn_started_at, m.started_at) > now() - interval '10 minutes';
$$;

create or replace function public.live_stats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'games', (select count(*) from public.matches m where public._is_live(m)),
    'viewers', (select count(distinct v.user_id) from public.live_viewers v join public.matches m on m.id = v.match_id
                 where v.last_seen > now() - interval '45 seconds' and public._is_live(m)));
$$;

create or replace function public.live_list(p_limit int default 20, p_offset int default 0) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select m.id, m.started_at, m.move_count, m.time_control, m.vs_bot, m.bot_level, m.rated,
           m.white_ms, m.black_ms, m.turn_started_at,
           wp.username as white_name, wp.avatar as white_avatar, wp.rating as white_rating,
           coalesce(bp.username, vp.nickname) as black_name, coalesce(bp.avatar, vp.avatar) as black_avatar,
           coalesce(bp.rating, vp.rating) as black_rating, m.virtual_id is not null as black_virtual,
           (select count(*) from public.live_viewers v where v.match_id = m.id and v.last_seen > now() - interval '45 seconds') as viewers,
           (select coalesce(json_agg(json_build_array(mm.from_sq, mm.path) order by mm.ply), '[]'::json) from public.match_moves mm where mm.match_id = m.id) as moves
    from public.matches m
    join public.profiles wp on wp.id = m.white_id
    left join public.profiles bp on bp.id = m.black_id
    left join public.virtual_players vp on vp.id = m.virtual_id
    where public._is_live(m)
    order by (select count(*) from public.live_viewers v where v.match_id = m.id and v.last_seen > now() - interval '45 seconds') desc,
             (coalesce(wp.rating, 0) + coalesce(bp.rating, vp.rating, 0)) desc, m.started_at desc
    limit greatest(1, least(p_limit, 50)) offset greatest(0, p_offset)) x;
$$;

create or replace function public.my_games(p_before timestamptz default null, p_limit int default 20) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select m.id, m.ended_at, m.move_count, m.result, m.result_reason, m.vs_bot, m.bot_level, m.time_control, m.rated,
           m.white_id, m.black_id, m.white_delta, m.black_delta, m.is_public,
           wp.username as white_name, coalesce(bp.username, vp.nickname, case when m.vs_bot then 'DAMEO Bot' end) as black_name,
           m.virtual_id is not null as black_virtual
    from public.matches m join public.profiles wp on wp.id = m.white_id left join public.profiles bp on bp.id = m.black_id
    left join public.virtual_players vp on vp.id = m.virtual_id
    where (m.white_id = auth.uid() or m.black_id = auth.uid()) and m.status = 'finished'
      and (p_before is null or m.ended_at < p_before)
    order by m.ended_at desc limit greatest(1, least(p_limit, 50))) x;
$$;

-- public card of a virtual opponent (+ their last finished games)
create or replace function public.virtual_profile(p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', v.id, 'nickname', v.nickname, 'avatar', v.avatar, 'style', v.style, 'level', v.level,
                           'rating', v.rating, 'wins', v.wins, 'losses', v.losses, 'draws', v.draws, 'enabled', v.enabled,
                           'recent', (select coalesce(json_agg(r), '[]'::json) from (
                               select m.id, m.ended_at, m.result, m.time_control, wp.username as opponent
                                 from public.matches m join public.profiles wp on wp.id = m.white_id
                                where m.virtual_id = v.id and m.status = 'finished' and m.is_public
                                order by m.ended_at desc limit 10) r))
    from public.virtual_players v where v.id = p_id;
$$;

/* ================================================================= admin */
create or replace function public._admin_perms(p_role text) returns text[]
language sql immutable set search_path = public as $$
  select case p_role
    when 'super_admin' then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view','roles.manage',
                                  'virtual.manage']
    when 'admin'       then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view',
                                  'virtual.manage']
    when 'moderator'   then array['dashboard','users.view','users.ban','reports.view','reports.manage','chat.moderate']
    when 'support'     then array['dashboard','users.view','balance.view','payments.view','reports.view']
    else array[]::text[] end;
$$;

create or replace function public.admin_virtual_overview() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage');
begin
  return json_build_object(
    'settings', (select json_build_object('enabled', s.enabled, 'auto_off', s.auto_off, 'auto_off_threshold', s.auto_off_threshold,
                                          'updated_at', s.updated_at) from public.virtual_settings s where s.id),
    'active_now', public._virtual_active(),
    'online_real', (select count(*) from public.profiles p where p.last_seen > now() - interval '5 minutes'),
    'live_games', (select count(*) from public.matches m where m.status = 'active' and m.virtual_id is not null),
    'players', (select coalesce(json_agg(json_build_object(
                    'id', v.id, 'nickname', v.nickname, 'avatar', v.avatar, 'style', v.style, 'level', v.level, 'rating', v.rating,
                    'wins', v.wins, 'losses', v.losses, 'draws', v.draws, 'enabled', v.enabled,
                    'games_today', (select count(*) from public.matches m where m.virtual_id = v.id and m.created_at > now() - interval '24 hours'),
                    'playing', (select count(*) from public.matches m where m.virtual_id = v.id and m.status = 'active'))
                  order by v.sort), '[]'::json) from public.virtual_players v));
end $$;

create or replace function public.admin_virtual_save(p_id uuid, p_enabled boolean, p_level text, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage'); r text := public._need_reason(p_reason); before jsonb;
begin
  if p_level is not null and p_level not in ('beginner', 'normal', 'pro') then raise exception 'bad level'; end if;
  select to_jsonb(v) into before from public.virtual_players v where id = p_id;
  if before is null then raise exception 'not found'; end if;
  update public.virtual_players set enabled = coalesce(p_enabled, enabled), level = coalesce(p_level, level) where id = p_id;
  perform public._audit(uid, 'virtual.save', 'virtual', p_id::text, r,
                        jsonb_build_object('before', jsonb_build_object('enabled', before->'enabled', 'level', before->'level'),
                                           'after', jsonb_build_object('enabled', p_enabled, 'level', p_level)));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_virtual_settings_save(p_enabled boolean, p_auto_off boolean, p_threshold int, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage'); r text := public._need_reason(p_reason);
begin
  if p_threshold is not null and (p_threshold < 1 or p_threshold > 100000) then raise exception 'bad threshold'; end if;
  update public.virtual_settings
     set enabled = coalesce(p_enabled, enabled), auto_off = coalesce(p_auto_off, auto_off),
         auto_off_threshold = coalesce(p_threshold, auto_off_threshold), updated_at = now(), updated_by = uid
   where id;
  perform public._audit(uid, 'virtual.settings', 'virtual', null, r,
                        jsonb_build_object('enabled', p_enabled, 'auto_off', p_auto_off, 'threshold', p_threshold));
  return json_build_object('ok', true);
end $$;

/* ================================================================= grants */
revoke all on function public._virtual_active(), public.virtual_match(int), public.virtual_commit(uuid, int), public._flag(uuid),
  public._close_abandoned_untimed(), public.finish_expired_games(), public._virtual_stats(), public.virtual_rematch(uuid),
  public._is_live(public.matches), public.live_stats(), public.live_list(int, int), public.my_games(timestamptz, int),
  public.virtual_profile(uuid), public.admin_virtual_overview(), public.admin_virtual_save(uuid, boolean, text, text),
  public.admin_virtual_settings_save(boolean, boolean, int, text)
from public, anon, authenticated;
grant execute on function public.virtual_match(int), public.virtual_rematch(uuid), public.my_games(timestamptz, int),
  public.admin_virtual_overview(), public.admin_virtual_save(uuid, boolean, text, text),
  public.admin_virtual_settings_save(boolean, boolean, int, text) to authenticated;
grant execute on function public.live_stats(), public.live_list(int, int), public.virtual_profile(uuid) to anon, authenticated;
grant execute on function public.virtual_commit(uuid, int), public.finish_expired_games() to service_role;

/* ================================================================= one-time cleanup of the games stuck as "active" */
select public._close_abandoned_untimed();
