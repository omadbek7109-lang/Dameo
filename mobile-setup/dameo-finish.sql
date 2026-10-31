-- DAMEO: last step. Paste into Supabase → SQL Editor → Run. (Creates 5 functions that remove rows: leave queue, reject/remove friend, withdraw from tournament.)
create or replace function public.quick_match() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = uid;
  delete from public.matchmaking_queue where created_at < now() - interval '2 minutes';
  select q.* into other from public.matchmaking_queue q
   where q.user_id <> uid and abs(q.rating - me.rating) <= 150 + 10 * extract(epoch from (now() - q.created_at))::int
   order by abs(q.rating - me.rating) limit 1 for update skip locked;
  if found then
    delete from public.matchmaking_queue where user_id in (uid, other.user_id);
    flip := random() < 0.5;
    insert into public.matches (white_id, black_id, status, rated, started_at)
    values (case when flip then uid else other.user_id end, case when flip then other.user_id else uid end, 'active', true, now())
    returning * into m;
    return json_build_object('match_id', m.id);
  end if;
  insert into public.matchmaking_queue (user_id, rating) values (uid, me.rating)
    on conflict (user_id) do update set rating = excluded.rating, created_at = now();
  return json_build_object('match_id', null);
end $$;

create or replace function public.cancel_quick_match() returns void
language sql security definer set search_path = public as $$
  delete from public.matchmaking_queue where user_id = auth.uid();
$$;

create or replace function public.respond_friend_request(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if p_accept then
    update public.friendships set status = 'accepted' where id = p_request and addressee_id = uid and status = 'pending';
  else
    delete from public.friendships where id = p_request and addressee_id = uid and status = 'pending';
  end if;
  if not found then raise exception 'request not found'; end if;
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friendships where status = 'accepted'
   and ((requester_id = auth.uid() and addressee_id = p_user) or (addressee_id = auth.uid() and requester_id = p_user));
$$;

create or replace function public.unregister_from_tournament(p_tournament uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.tournament_registrations r using public.tournaments t
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and t.id = r.tournament_id and t.status = 'upcoming';
$$;

revoke execute on function public.quick_match(), public.cancel_quick_match(), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.unregister_from_tournament(uuid) from public, anon;
grant execute on function public.quick_match(), public.cancel_quick_match(), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.unregister_from_tournament(uuid) to authenticated;
