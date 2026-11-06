-- DAMEO 0019: new rating rules, win-streak achievements with coin rewards, virtual opponents v2.
--
-- Rating (server only, applied exactly once per game by apply_match_result)
--   * win  → random +15 … +30, loss → random −15 … −30 (rating never below 100)
--   * draw → small balanced change: the lower-rated player gains up to +5, the higher-rated loses up to −5
--   * games against virtual opponents are rated too and recorded with source 'virtual' in rating_history;
--     the weekly tournament (real prizes) keeps counting player-vs-player games only (0010 already filters vs_bot)
--   * anti-abuse:
--       - a game that ends before 6 moves: the loser still loses (leaving is not free), the winner gains nothing
--       - the same two players: only 3 rated games per 24 h; further games between them change nothing
--         (no rating, no stats, no streak)
--   * the old practice bot ("Bot bilan o'ynash") stays unrated
-- Achievements: first win, 3 / 5 / 10 wins in a row → 25 / 100 / 250 / 600 coins, credited once through the wallet
-- ledger (idempotency key per user + achievement) and announced as a notification + end-of-game dialog.
-- Virtual opponents v2: 12 names (the 4 gamer tags are switched off, kept for history), 3–4 "on duty" at a time
-- (rotates hourly), auto on/off with hysteresis on real online players (off above 48, back on below 30 — both
-- admin-editable), rematch answered 50/50.
-- Additive: new columns / tables / functions; nothing is deleted.

/* ================================================================= columns */
alter table public.rating_history add column if not exists source text;
alter table public.rating_history add column if not exists delta int;
alter table public.profiles add column if not exists current_streak int not null default 0;
alter table public.profiles add column if not exists best_streak int not null default 0;
alter table public.matches add column if not exists rating_note text;   -- 'short' | 'pair-limit' when anti-abuse applied

alter table public.virtual_settings add column if not exists auto_on_threshold int not null default 30;
alter table public.virtual_settings add column if not exists auto_state boolean not null default true;
alter table public.virtual_settings add column if not exists pool_size int not null default 4;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'virtual_settings_pool_size_check') then
    alter table public.virtual_settings add constraint virtual_settings_pool_size_check check (pool_size between 1 and 12);
  end if;
end $$;
-- spec defaults: helpers when fewer than 48 real players are online, back on below 30
update public.virtual_settings set auto_off = true, auto_off_threshold = 48, auto_on_threshold = 30 where id and auto_off_threshold = 30 and not auto_off;

/* ================================================================= achievements */
create table if not exists public.user_achievements (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  code        text not null check (code in ('first_win', 'streak_3', 'streak_5', 'streak_10')),
  unlocked_at timestamptz not null default now(),
  match_id    uuid,
  reward      int not null default 0,
  primary key (user_id, code)
);
alter table public.user_achievements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_achievements' and policyname = 'user_achievements_own') then
    create policy user_achievements_own on public.user_achievements for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
grant select on public.user_achievements to authenticated;

create or replace function public._ach_rewards() returns table (code text, need int, reward int, kind text)
language sql immutable as $$
  values ('first_win', 1, 25, 'wins'), ('streak_3', 3, 100, 'streak'), ('streak_5', 5, 250, 'streak'), ('streak_10', 10, 600, 'streak');
$$;

-- unlock what the player has just earned; coins go through the ledger with a per-user key, so never twice
create or replace function public._ach_check(p_user uuid, p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.profiles; a record; inserted int;
begin
  select * into pr from public.profiles where id = p_user;
  for a in select * from public._ach_rewards() loop
    if (a.kind = 'wins' and pr.wins >= a.need) or (a.kind = 'streak' and pr.current_streak >= a.need) then
      insert into public.user_achievements (user_id, code, match_id, reward) values (p_user, a.code, p_match, a.reward)
      on conflict (user_id, code) do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        perform public._wallet_apply(p_user, a.reward, 'reward', 'achievement', a.code, 'ach:' || a.code, 'Achievement ' || a.code, null);
        perform public._notify(p_user, 'achievement', a.code, '+' || a.reward || ' DAMEO Coins',
                               jsonb_build_object('code', a.code, 'reward', a.reward, 'match_id', p_match));
      end if;
    end if;
  end loop;
end $$;

/* ================================================================= rating */
create or replace function public._rand_delta(p_score numeric, p_me int, p_opp int) returns int
language sql volatile as $$
  select case when p_score = 1 then 15 + floor(random() * 16)::int
              when p_score = 0 then -(15 + floor(random() * 16)::int)
              else greatest(-5, least(5, round((coalesce(p_opp, 1200) - p_me) / 50.0)::int)) end;
$$;

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
    -- the same pair: at most 3 rated games per 24 h
    select count(*) into pair_games from public.matches x
     where x.id <> m.id and x.rating_applied and x.rating_note is null and x.ended_at > now() - interval '24 hours'
       and ((x.white_id = m.white_id and x.black_id = m.black_id) or (x.white_id = m.black_id and x.black_id = m.white_id));
    if pair_games >= 3 then note := 'pair-limit'; end if;
  end if;

  if note = 'pair-limit' then
    update public.matches set rating_applied = true, white_delta = 0, black_delta = 0, rating_note = note where id = m.id;
    return;
  end if;

  wd := public._rand_delta(ws, w.rating, coalesce(b.rating, v.rating));
  bd := public._rand_delta(1 - ws, coalesce(b.rating, v.rating), w.rating);
  -- ended before 6 moves: the loser still loses, nobody gains
  if m.move_count < 6 then
    note := 'short';
    wd := least(wd, 0);
    bd := least(bd, 0);
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

-- virtual players' own W/L/D (rating now moves in apply_match_result with the same random rules)
create or replace function public._virtual_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.virtual_id is not null and old.status = 'active' and new.status = 'finished' then
    update public.virtual_players
       set wins = wins + (new.result = 'black')::int, losses = losses + (new.result = 'white')::int, draws = draws + (new.result = 'draw')::int,
           rating = case when new.rated then rating
                         else greatest(100, least(3000, rating + case new.result when 'black' then 5 when 'white' then -5 else 0 end)) end
     where id = new.virtual_id;
  end if;
  return new;
end $$;

/* ================================================================= virtual opponents v2 */
do $$
declare base text := 'https://omadbek7109-lang.github.io/Dameo/docs/vp/';
begin
  insert into public.virtual_players (nickname, avatar, gender, style, level, rating, sort) values
    ('Sevinch', base || 'sevinch.svg', 'f', 'tricky',     'normal',   1215, 11),
    ('Malika',  base || 'malika.svg',  'f', 'solid',      'pro',      1375, 12),
    ('Jasur',   base || 'jasur.svg',   'm', 'aggressive', 'normal',   1245, 13),
    ('Aziz',    base || 'aziz.svg',    'm', 'calm',       'beginner', 1105, 14),
    ('Kamron',  base || 'kamron.svg',  'm', 'fast',       'normal',   1190, 15),
    ('Sardor',  base || 'sardor.svg',  'm', 'solid',      'pro',      1405, 16)
  on conflict (nickname) do nothing;
end $$;
-- gamer tags from 0017 → switched off (their games and stats stay)
update public.virtual_players set enabled = false where nickname in ('DarkSoul', 'MrNobody', 'just_me', 'Silent');

-- 3–4 opponents "on duty" at a time, rotating every hour among the enabled ones
create or replace function public._virtual_on_duty() returns setof public.virtual_players
language sql stable security definer set search_path = public as $$
  select v.* from public.virtual_players v
   where v.enabled
   order by md5(v.id::text || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'))
   limit (select pool_size from public.virtual_settings where id);
$$;

-- on/off with hysteresis: off when real online players exceed auto_off_threshold, back on below auto_on_threshold
create or replace function public._virtual_active() returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare s public.virtual_settings; online int; st boolean;
begin
  select * into s from public.virtual_settings where id;
  if not found or not s.enabled then return false; end if;
  if not s.auto_off then return true; end if;
  select count(*) into online from public.profiles p where p.last_seen > now() - interval '5 minutes';
  st := case when online > s.auto_off_threshold then false when online < s.auto_on_threshold then true else s.auto_state end;
  if st is distinct from s.auto_state then update public.virtual_settings set auto_state = st where id; end if;
  return st;
end $$;

-- 0017 + on-duty pool + rated games
create or replace function public.virtual_match(p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q public.matchmaking_queue; me public.profiles; v public.virtual_players; m public.matches; prev record; existing uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (60, 180, 300) then raise exception 'bad time control'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
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
  select * into v from public._virtual_on_duty() d
   where d.id not in (select x.virtual_id from public.matches x where x.white_id = uid and x.virtual_id is not null order by x.created_at desc limit 2)
   order by random() * (1 + abs(d.rating - me.rating) / 250.0) limit 1;
  if not found then select * into v from public._virtual_on_duty() order by random() limit 1; end if;
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

-- 0017 + the bot running out of time is a rated result too
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
    if m.rated then perform public.apply_match_result(m.id); end if;
    return json_build_object('ok', false, 'error', 'timeout');
  end if;
  insert into public.match_moves (match_id, ply, from_sq, path)
  values (m.id, ply, (p->>'from')::int, array(select jsonb_array_elements_text(p->'path')::int));
  bms := m.black_ms - think;
  update public.matches set move_count = ply + 1, black_ms = bms, turn_started_at = t, bot_pending = null, bot_due_at = null where id = m.id;
  return json_build_object('ok', true, 'ply', ply, 'from', (p->>'from')::int, 'path', p->'path',
                           'white_ms', m.white_ms, 'black_ms', bms, 'turn_started_at', t);
end $$;

-- rematch: answered 50/50, once per game
create or replace function public.virtual_rematch(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; v public.virtual_players; nm public.matches;
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
  if not v.enabled or not public._virtual_active() or m.time_control is null or random() >= 0.5 then
    update public.matches set virtual_rematch = 'declined' where id = m.id;
    return json_build_object('accepted', false, 'match_id', null);
  end if;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, virtual_id, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (uid, 'active', true, true, m.bot_level, m.virtual_id, now(), m.time_control, m.time_control * 1000, m.time_control * 1000, now())
  returning * into nm;
  update public.matches set virtual_rematch = nm.id::text where id = m.id;
  return json_build_object('accepted', true, 'match_id', nm.id);
end $$;

-- public card: games count too (no "virtual" flag needed by the app beyond the profile note)
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

/* ================================================================= achievements: reads */
create or replace function public.achievements_mine() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr public.profiles;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = uid;
  return json_build_object(
    'current_streak', pr.current_streak, 'best_streak', pr.best_streak, 'wins', pr.wins,
    'items', (select json_agg(json_build_object(
                'code', r.code, 'need', r.need, 'reward', r.reward, 'kind', r.kind,
                'progress', least(r.need, case r.kind when 'wins' then pr.wins else greatest(pr.current_streak, 0) end),
                'unlocked_at', a.unlocked_at) order by r.need)
              from public._ach_rewards() r left join public.user_achievements a on a.user_id = uid and a.code = r.code));
end $$;

-- what this game unlocked for me (end-of-game congratulations)
create or replace function public.achievements_for_match(p_match uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('code', a.code, 'reward', a.reward) order by a.reward), '[]'::json)
    from public.user_achievements a where a.user_id = auth.uid() and a.match_id = p_match;
$$;

/* ================================================================= admin */
create or replace function public.admin_virtual_overview() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage');
begin
  return json_build_object(
    'settings', (select json_build_object('enabled', s.enabled, 'auto_off', s.auto_off, 'auto_off_threshold', s.auto_off_threshold,
                                          'auto_on_threshold', s.auto_on_threshold, 'auto_state', s.auto_state, 'pool_size', s.pool_size,
                                          'updated_at', s.updated_at) from public.virtual_settings s where s.id),
    'active_now', public._virtual_active(),
    'online_real', (select count(*) from public.profiles p where p.last_seen > now() - interval '5 minutes'),
    'live_games', (select count(*) from public.matches m where m.status = 'active' and m.virtual_id is not null),
    'on_duty', (select coalesce(json_agg(d.id), '[]'::json) from public._virtual_on_duty() d),
    'players', (select coalesce(json_agg(json_build_object(
                    'id', v.id, 'nickname', v.nickname, 'avatar', v.avatar, 'style', v.style, 'level', v.level, 'rating', v.rating,
                    'wins', v.wins, 'losses', v.losses, 'draws', v.draws, 'enabled', v.enabled,
                    'games_today', (select count(*) from public.matches m where m.virtual_id = v.id and m.created_at > now() - interval '24 hours'),
                    'playing', (select count(*) from public.matches m where m.virtual_id = v.id and m.status = 'active'))
                  order by v.enabled desc, v.sort), '[]'::json) from public.virtual_players v));
end $$;

create or replace function public.admin_virtual_settings_save2(p_enabled boolean, p_auto_off boolean, p_off_threshold int,
                                                              p_on_threshold int, p_pool int, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage'); r text := public._need_reason(p_reason); s public.virtual_settings;
begin
  select * into s from public.virtual_settings where id;
  if coalesce(p_on_threshold, s.auto_on_threshold) > coalesce(p_off_threshold, s.auto_off_threshold) then
    raise exception 'on threshold must not exceed off threshold';
  end if;
  if p_pool is not null and (p_pool < 1 or p_pool > 12) then raise exception 'bad pool size'; end if;
  update public.virtual_settings
     set enabled = coalesce(p_enabled, enabled), auto_off = coalesce(p_auto_off, auto_off),
         auto_off_threshold = coalesce(p_off_threshold, auto_off_threshold), auto_on_threshold = coalesce(p_on_threshold, auto_on_threshold),
         pool_size = coalesce(p_pool, pool_size), updated_at = now(), updated_by = uid
   where id;
  perform public._audit(uid, 'virtual.settings', 'virtual', null, r,
                        jsonb_build_object('enabled', p_enabled, 'auto_off', p_auto_off, 'off', p_off_threshold, 'on', p_on_threshold, 'pool', p_pool));
  return json_build_object('ok', true);
end $$;

/* ================================================================= shop: a "Futbol" tab */
-- the football sets stay in the pieces page (first group) and also get their own tab (the app shows collection 'football')
insert into public.shop_categories (id, name_uz, name_en, sort, visible) values ('football', 'Futbol', 'Football', 2, true)
on conflict (id) do nothing;

/* ================================================================= grants */
revoke all on function public._ach_rewards(), public._ach_check(uuid, uuid), public._rand_delta(numeric, int, int),
  public.apply_match_result(uuid), public._virtual_stats(), public._virtual_on_duty(), public._virtual_active(),
  public.virtual_match(int), public.virtual_commit(uuid, int), public.virtual_rematch(uuid), public.virtual_profile(uuid),
  public.achievements_mine(), public.achievements_for_match(uuid), public.admin_virtual_overview(),
  public.admin_virtual_settings_save2(boolean, boolean, int, int, int, text)
from public, anon, authenticated;
grant execute on function public.virtual_match(int), public.virtual_rematch(uuid), public.achievements_mine(),
  public.achievements_for_match(uuid), public.admin_virtual_overview(),
  public.admin_virtual_settings_save2(boolean, boolean, int, int, int, text) to authenticated;
grant execute on function public.virtual_profile(uuid) to anon, authenticated;
grant execute on function public.apply_match_result(uuid), public.virtual_commit(uuid, int) to service_role;
-- 0017 left TRUNCATE open on these two tables (not reachable through the API, closed anyway)
revoke truncate on public.virtual_players, public.virtual_settings from anon, authenticated;
