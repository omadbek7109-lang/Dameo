-- DAMEO 0007: quick_match also reports when the search started (server clock) so the client countdown
-- is anchored to the server, not to its own polling loop. Same signature, same pairing logic, no schema change.
create or replace function public.quick_match() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean; since timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = uid;
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and q.last_seen > now() - interval '15 seconds'
     and abs(q.rating - me.rating) <= 150 + 10 * extract(epoch from (now() - q.created_at))::int
   order by abs(q.rating - me.rating), q.created_at limit 1 for update skip locked;
  if found then
    update public.matchmaking_queue set last_seen = '-infinity' where user_id in (uid, other.user_id);
    flip := random() < 0.5;
    insert into public.matches (white_id, black_id, status, rated, started_at)
    values (case when flip then uid else other.user_id end, case when flip then other.user_id else uid end, 'active', true, now())
    returning * into m;
    return json_build_object('match_id', m.id);
  end if;
  insert into public.matchmaking_queue (user_id, rating, created_at, last_seen) values (uid, me.rating, now(), now())
  on conflict (user_id) do update set
    rating = excluded.rating,
    created_at = case when public.matchmaking_queue.last_seen < now() - interval '15 seconds' then now() else public.matchmaking_queue.created_at end,
    last_seen = now()
  returning created_at into since;
  return json_build_object('match_id', null, 'searching_since', since, 'server_now', clock_timestamp());
end $$;
