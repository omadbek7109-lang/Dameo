-- 0044 — Quick match: no rating limit for now (few players online). Same time control is still required;
-- the closest rating among the waiting players is still preferred. Elo keeps it fair (a big favourite gains little).
-- Before: |rating difference| <= 150 + 10 per second waited.
create or replace function public.quick_match(p_time integer) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_time is null or p_time not in (180, 300, 480) then raise exception 'bad time control'; end if;
  select * into me from public.profiles where id = uid;
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and q.last_seen > now() - interval '15 seconds' and q.time_control = p_time
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
