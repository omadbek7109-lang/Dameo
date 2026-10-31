-- DAMEO server-side logic. All functions are SECURITY DEFINER with a pinned search_path.

/* ---------------------------------------------------------------- presence */
create or replace function public.touch_presence() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now() where id = auth.uid();
$$;

/* ------------------------------------------------------------ leaderboard */
create or replace function public.leaderboard_page(p_scope text, p_search text, p_limit int, p_offset int)
returns table (id uuid, username text, avatar text, rating int, wins int, losses int, draws int,
               last_seen timestamptz, country text, last_delta int, rank int, total_count bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select l.* from public.leaderboard l
    where (p_scope <> 'top100' or l.rank <= 100)
      and (p_scope <> 'friends' or l.id = auth.uid() or exists (
            select 1 from public.friendships f where f.status = 'accepted'
              and ((f.requester_id = auth.uid() and f.addressee_id = l.id) or (f.addressee_id = auth.uid() and f.requester_id = l.id))))
      and (coalesce(p_search, '') = '' or l.username ilike '%' || replace(replace(p_search, '%', ''), '_', '\_') || '%')
  )
  select b.id, b.username, b.avatar, b.rating, b.wins, b.losses, b.draws, b.last_seen, b.country, b.last_delta, b.rank,
         count(*) over () as total_count
  from base b order by b.rank, b.username
  limit greatest(least(p_limit, 50), 0) offset greatest(p_offset, 0);
$$;

/* ---------------------------------------------------------------- ratings */
-- Elo with a provisional period (kept identical to src/services/rating.ts):
--   K = 40 for the first 20 rated games, otherwise 24; start 1200; floor 100.
create or replace function public.rating_delta(p_player int, p_opp int, p_score numeric, p_games int)
returns int language sql immutable as $$
  select greatest(100, round(p_player + (case when p_games < 20 then 40 else 24 end)
           * (p_score - 1.0 / (1.0 + power(10.0, (p_opp - p_player) / 400.0))))::int) - p_player;
$$;

-- Applies the rating change for a FINISHED, RATED match exactly once. Callable only by the service role.
create or replace function public.apply_match_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  w public.profiles%rowtype;
  b public.profiles%rowtype;
  ws numeric; bs numeric; wd int; bd int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'finished' or m.rating_applied or not m.rated or m.black_id is null then return; end if;
  select * into w from public.profiles where id = m.white_id for update;
  select * into b from public.profiles where id = m.black_id for update;
  ws := case m.result when 'white' then 1 when 'draw' then 0.5 else 0 end;
  bs := 1 - ws;
  wd := public.rating_delta(w.rating, b.rating, ws, w.rated_games);
  bd := public.rating_delta(b.rating, w.rating, bs, b.rated_games);
  update public.profiles set rating = rating + wd, rated_games = rated_games + 1, last_delta = wd,
         wins = wins + (m.result = 'white')::int, losses = losses + (m.result = 'black')::int, draws = draws + (m.result = 'draw')::int
   where id = w.id;
  update public.profiles set rating = rating + bd, rated_games = rated_games + 1, last_delta = bd,
         wins = wins + (m.result = 'black')::int, losses = losses + (m.result = 'white')::int, draws = draws + (m.result = 'draw')::int
   where id = b.id;
  insert into public.rating_history (user_id, match_id, rating) values (w.id, m.id, w.rating + wd), (b.id, m.id, b.rating + bd);
  update public.matches set rating_applied = true, white_delta = wd, black_delta = bd where id = m.id;
end $$;
revoke all on function public.apply_match_result(uuid) from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid) to service_role;

/* ------------------------------------------------------------ rooms & queue */
create or replace function public._new_code() returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.matches where code = c);
  end loop;
  return c;
end $$;

create or replace function public.create_room() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.matches (white_id, code, status, rated) values (uid, public._new_code(), 'waiting', false) returning * into m;
  return json_build_object('match_id', m.id, 'code', m.code);
end $$;

create or replace function public.join_room(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from public.matches where code = upper(trim(p_code)) and status = 'waiting' for update;
  if not found then raise exception 'room not found'; end if;
  if m.white_id = uid then raise exception 'cannot join your own room'; end if;
  update public.matches set black_id = uid, status = 'active', started_at = now() where id = m.id;
  return json_build_object('match_id', m.id);
end $$;

-- Matchmaking: pair with the closest-rated waiting player (window widens with waiting time).
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

/* ------------------------------------------------------------------ friends */
create or replace function public.search_players(p_query text)
returns table (id uuid, username text, avatar text, rating int, wins int, losses int, draws int, last_seen timestamptz, country text, last_delta int)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.avatar, p.rating, p.wins, p.losses, p.draws, p.last_seen, p.country, p.last_delta
  from public.profiles p
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and length(trim(p_query)) >= 2
    and p.username ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '\_') || '%'
  order by p.rating desc limit 20;
$$;

create or replace function public.send_friend_request(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); f public.friendships;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_user = uid then raise exception 'cannot befriend yourself'; end if;
  select * into f from public.friendships
   where least(requester_id, addressee_id) = least(uid, p_user) and greatest(requester_id, addressee_id) = greatest(uid, p_user);
  if found then
    -- they already asked us: sending a request back accepts it
    if f.status = 'pending' and f.addressee_id = uid then update public.friendships set status = 'accepted' where id = f.id; return; end if;
    raise exception 'request already exists';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (uid, p_user);
end $$;

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

create or replace function public.list_relations()
returns table (request_id uuid, relation text, id uuid, username text, avatar text, rating int, wins int, losses int, draws int,
               last_seen timestamptz, country text, last_delta int)
language sql stable security definer set search_path = public as $$
  select f.id,
         case when f.status = 'accepted' then 'friend' when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end,
         p.id, p.username, p.avatar, p.rating, p.wins, p.losses, p.draws, p.last_seen, p.country, p.last_delta
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id);
$$;

create or replace function public.invite_to_game(p_friend uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester_id = uid and f.addressee_id = p_friend) or (f.addressee_id = uid and f.requester_id = p_friend))) then
    raise exception 'not friends';
  end if;
  insert into public.matches (white_id, code, status, rated) values (uid, public._new_code(), 'waiting', false) returning * into m;
  insert into public.game_invites (match_id, code, from_id, to_id) values (m.id, m.code, uid, p_friend);
  return json_build_object('match_id', m.id, 'code', m.code);
end $$;

/* -------------------------------------------------------------- tournaments */
create or replace function public.register_for_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.tournaments; n int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then raise exception 'tournament not found'; end if;
  if t.status <> 'upcoming' or t.starts_at <= now() then raise exception 'registration closed'; end if;
  select count(*) into n from public.tournament_registrations where tournament_id = t.id;
  if n >= t.capacity then raise exception 'tournament full'; end if;
  insert into public.tournament_registrations (tournament_id, user_id) values (t.id, uid) on conflict do nothing;
end $$;

create or replace function public.unregister_from_tournament(p_tournament uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.tournament_registrations r using public.tournaments t
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and t.id = r.tournament_id and t.status = 'upcoming';
$$;

/* ------------------------------------------------------------------ grants */
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.touch_presence(), public.leaderboard_page(text, text, int, int), public.create_room(), public.join_room(text),
  public.quick_match(), public.cancel_quick_match(), public.search_players(text), public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid), public.list_relations(),
  public.invite_to_game(uuid), public.register_for_tournament(uuid), public.unregister_from_tournament(uuid)
  to authenticated;
grant execute on function public.leaderboard_page(text, text, int, int), public.search_players(text) to anon;
revoke execute on function public.apply_match_result(uuid), public._new_code() from authenticated;
