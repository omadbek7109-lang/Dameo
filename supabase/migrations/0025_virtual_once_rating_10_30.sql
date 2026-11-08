-- DAMEO 0025: virtual opponents — one game per opponent, no rematch; one rating rule for every rated game.
--  * Rating (player vs player and player vs virtual opponent alike): win → random +10 … +30, loss → random −10 … −30.
--    Draws, the "short game" and same-pair limits stay as in 0019.
--  * A player meets each virtual opponent only once (see virtual_match); after a game the next search finds someone new.
--  * Rematch with a virtual opponent is switched off: virtual_rematch always answers "declined" (also for old app
--    versions still in a cache) and never creates a game.
-- Additive: functions replaced only; no data is changed.

create or replace function public._rand_delta(p_score numeric, p_me int, p_opp int) returns int
language sql volatile as $$
  select case when p_score = 1 then 10 + floor(random() * 21)::int
              when p_score = 0 then -(10 + floor(random() * 21)::int)
              else greatest(-5, least(5, round((coalesce(p_opp, 1200) - p_me) / 50.0)::int)) end;
$$;

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

create or replace function public.virtual_rematch(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from public.matches where id = p_match for update;
  if not found or m.white_id <> uid or m.virtual_id is null then raise exception 'match not found'; end if;
  if m.status <> 'finished' then raise exception 'game not finished'; end if;
  if m.virtual_rematch is null then update public.matches set virtual_rematch = 'declined' where id = m.id; end if;
  return json_build_object('accepted', false, 'match_id', null);
end $$;
