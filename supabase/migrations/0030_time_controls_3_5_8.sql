-- DAMEO 0030: rated time controls are now 3 / 5 / 8 minutes (the 1-minute mode is removed).
--  * New games: quick_match and virtual_match accept only 180, 300 or 480 seconds; matchmaking still pairs only players
--    who picked the SAME time control (unchanged rule, q.time_control = p_time).
--  * History is kept: the 92 finished 1-minute games (and their ratings) stay valid, so the CHECK constraints allow
--    60 for existing rows; no function can create a new 60-second game any more. A rematch of an old 1-minute game
--    starts as a 3-minute game.
--  * Clocks, the 30 s move limit, loss on time, Elo and rewards are untouched (same functions, same rules).
--  * Unrated games (practice bots, friend rooms) are unchanged.

-- constraints: add 480 (the only schema change; 60 stays valid for existing rows)
alter table public.matches drop constraint if exists matches_time_control_check;
alter table public.matches add constraint matches_time_control_check check (time_control in (60, 180, 300, 480));
alter table public.matchmaking_queue drop constraint if exists matchmaking_queue_time_control_check;
alter table public.matchmaking_queue add constraint matchmaking_queue_time_control_check check (time_control in (60, 180, 300, 480));

create or replace function public.quick_match(p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
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
    created_at = case when public.matchmaking_queue.last_seen < now() - interval '15 seconds'
                        or public.matchmaking_queue.time_control <> excluded.time_control
                      then now() else public.matchmaking_queue.created_at end,
    time_control = excluded.time_control,
    last_seen = now()
  returning created_at into since;
  return json_build_object('match_id', null, 'searching_since', since, 'server_now', clock_timestamp(), 'time_control', p_time);
end $$;

create or replace function public.virtual_match(p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q public.matchmaking_queue; me public.profiles; v public.virtual_players; m public.matches; prev record; existing uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
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
  -- each virtual opponent meets a player only once: first someone "online" the player has never played,
  -- then any enabled one never played; only when all were played, the one played longest ago (never the last one)
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

create or replace function public.match_respond_rematch(p_match uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; offer public.match_chat_messages; n public.matches; tc int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.black_id is null or m.vs_bot or uid not in (m.white_id, m.black_id) then raise exception 'match not found'; end if;
  select * into offer from public.match_chat_messages where match_id = p_match and kind = 'rematch_offer' order by id desc limit 1;
  if not found or offer.user_id = uid
     or exists (select 1 from public.match_chat_messages where match_id = p_match and id > offer.id and kind in ('rematch_accept', 'rematch_decline')) then
    raise exception 'no open offer';
  end if;
  if not p_accept then
    insert into public.match_chat_messages (match_id, user_id, kind) values (p_match, uid, 'rematch_decline');
    return json_build_object('ok', true, 'match_id', null);
  end if;
  tc := case when m.time_control = 60 then 180 else m.time_control end;   -- the 1-minute mode no longer exists
  insert into public.matches (white_id, black_id, status, rated, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (m.black_id, m.white_id, 'active', m.rated, now(), tc,
          case when tc is null then null else tc * 1000 end,
          case when tc is null then null else tc * 1000 end,
          case when tc is null then null else now() end)
  returning * into n;
  insert into public.match_chat_messages (match_id, user_id, kind, data) values (p_match, uid, 'rematch_accept', jsonb_build_object('match_id', n.id));
  return json_build_object('ok', true, 'match_id', n.id);
end $$;
