-- DAMEO: run this whole file once in Supabase → SQL Editor
-- DAMEO schema. Run with `supabase db push` (or paste into the SQL editor), then 0002_functions.sql.
-- Security model: the browser only ever holds the public anon key + the user's JWT.
-- Ratings, results and moves can NOT be written by clients: there are no INSERT/UPDATE policies
-- for them; they are written by SECURITY DEFINER functions / the `match-action` Edge Function.

create extension if not exists pgcrypto;

/* ------------------------------------------------------------------ profiles */
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  avatar       text not null default '212:0',
  rating       integer not null default 1200 check (rating >= 100),
  rated_games  integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  last_delta   integer not null default 0,
  country      text check (country is null or country ~ '^[A-Z]{2}$'),
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.]{3,20}$' or username ~ '^[^[:space:]]{3,20}$')
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));
create index profiles_rating_idx on public.profiles (rating desc, wins desc);
create index profiles_last_seen_idx on public.profiles (last_seen desc);

-- Create a profile automatically when a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'player');
  candidate text;
  n int := 0;
begin
  base := left(regexp_replace(base, '[^A-Za-z0-9_.]', '', 'g'), 16);
  if length(base) < 3 then base := 'player'; end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    n := n + 1;
    candidate := base || floor(random() * 9000 + 1000)::int;
    exit when n > 20;
  end loop;
  insert into public.profiles (id, username, avatar)
  values (new.id, candidate, (floor(random() * 360))::int || ':' || (floor(random() * 1000))::int);
  insert into public.rating_history (user_id, rating) values (new.id, 1200);   -- starting point of the rating chart
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.rating_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  match_id   uuid,
  rating     integer not null,
  created_at timestamptz not null default now()
);
create index rating_history_user_idx on public.rating_history (user_id, created_at);

/* ------------------------------------------------------------------- matches */
create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  white_id       uuid not null references public.profiles(id) on delete cascade,
  black_id       uuid references public.profiles(id) on delete cascade,
  status         text not null default 'waiting' check (status in ('waiting','active','finished','aborted')),
  rated          boolean not null default true,
  result         text check (result in ('white','black','draw')),
  result_reason  text check (result_reason in ('no-moves','resign','repetition','kings-only','agreement')),
  move_count     integer not null default 0,
  white_delta    integer,
  black_delta    integer,
  rating_applied boolean not null default false,   -- guards against duplicate rating updates
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  ended_at       timestamptz,
  constraint different_players check (black_id is null or black_id <> white_id),
  constraint finished_has_result check (status <> 'finished' or result is not null)
);
create index matches_white_idx on public.matches (white_id);
create index matches_black_idx on public.matches (black_id);
create index matches_status_idx on public.matches (status, created_at desc);

create table public.match_moves (
  match_id   uuid not null references public.matches(id) on delete cascade,
  ply        integer not null check (ply >= 0),
  from_sq    smallint not null check (from_sq between 0 and 63),
  path       smallint[] not null check (cardinality(path) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (match_id, ply)                      -- a ply can only be written once (no races / replays)
);

create table public.matchmaking_queue (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  rating     integer not null,
  created_at timestamptz not null default now()
);

/* -------------------------------------------------------------------- social */
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  constraint no_self_friend check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table public.game_invites (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  code       text not null,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index game_invites_to_idx on public.game_invites (to_id, created_at desc);

/* --------------------------------------------------------------- tournaments */
create table public.tournaments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 3 and 80),
  starts_at  timestamptz not null,
  capacity   integer not null check (capacity between 2 and 1024),
  status     text not null default 'upcoming' check (status in ('upcoming','in_progress','completed')),
  format     text not null default 'single_elimination' check (format in ('single_elimination','swiss','round_robin')),
  best_of    integer not null default 1 check (best_of in (1,3)),
  winner_id  uuid references public.profiles(id),
  created_at timestamptz not null default now()
  -- No fee column on purpose: all tournaments are free in the initial release.
);

create table public.tournament_registrations (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (tournament_id, user_id)             -- no duplicate registrations
);

/* --------------------------------------------------------------------- views */
-- Ranked leaderboard (public data only: no e-mail, no auth fields).
create view public.leaderboard as
  select p.id, p.username, p.avatar, p.rating, p.wins, p.losses, p.draws, p.last_seen, p.country, p.last_delta,
         rank() over (order by p.rating desc, p.wins desc, p.created_at asc)::int as rank
  from public.profiles p;

create view public.tournament_overview as
  select t.id, t.name, t.starts_at, t.capacity, t.status, t.format, t.best_of,
         w.username as winner_name,
         (select count(*) from public.tournament_registrations r where r.tournament_id = t.id)::int as participants
  from public.tournaments t left join public.profiles w on w.id = t.winner_id;

-- Respects RLS of the caller; the private room code is only shown to the two players.
create view public.match_view with (security_invoker = true) as
  select m.id,
         case when auth.uid() in (m.white_id, m.black_id) then m.code end as code,
         m.white_id, m.black_id, m.status, m.result, m.result_reason, m.rated, m.move_count, m.created_at,
         wp.username as white_name, wp.rating as white_rating,
         bp.username as black_name, bp.rating as black_rating
  from public.matches m
  join public.profiles wp on wp.id = m.white_id
  left join public.profiles bp on bp.id = m.black_id;

-- One row per player per finished game.
create view public.match_history as
  select m.id as match_id, m.white_id as user_id, m.ended_at, bp.username as opponent_name,
         case m.result when 'white' then 'win' when 'black' then 'loss' else 'draw' end as result,
         m.white_delta as delta, m.rated, m.move_count as moves
  from public.matches m join public.profiles bp on bp.id = m.black_id where m.status = 'finished'
  union all
  select m.id, m.black_id, m.ended_at, wp.username,
         case m.result when 'black' then 'win' when 'white' then 'loss' else 'draw' end,
         m.black_delta, m.rated, m.move_count
  from public.matches m join public.profiles wp on wp.id = m.white_id where m.status = 'finished' and m.black_id is not null;

/* ------------------------------------------------------- Row Level Security */
alter table public.profiles                  enable row level security;
alter table public.rating_history            enable row level security;
alter table public.matches                   enable row level security;
alter table public.match_moves               enable row level security;
alter table public.matchmaking_queue         enable row level security;
alter table public.friendships               enable row level security;
alter table public.game_invites              enable row level security;
alter table public.tournaments               enable row level security;
alter table public.tournament_registrations  enable row level security;

-- profiles: public read; a user may edit ONLY their own username/avatar/country.
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, avatar, country) on public.profiles to authenticated;   -- rating/stats are NOT grantable

create policy rating_history_read on public.rating_history for select to anon, authenticated using (true);

-- matches: players see their own rooms; active/finished games are public (spectating, history).
create policy matches_read on public.matches for select to anon, authenticated
  using (status in ('active','finished') or white_id = auth.uid() or black_id = auth.uid());
create policy match_moves_read on public.match_moves for select to anon, authenticated
  using (exists (select 1 from public.matches m where m.id = match_id
                 and (m.status in ('active','finished') or auth.uid() in (m.white_id, m.black_id))));
-- (no insert/update/delete policies: only the service role / security-definer functions write these)

create policy friendships_read on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy invites_read on public.game_invites for select to authenticated
  using (auth.uid() in (from_id, to_id));

create policy tournaments_read on public.tournaments for select to anon, authenticated using (true);
create policy registrations_read_own on public.tournament_registrations for select to authenticated using (user_id = auth.uid());
-- matchmaking_queue: no policies at all → unreachable from the API except through RPCs.

revoke all on public.matches, public.match_moves, public.matchmaking_queue, public.friendships, public.game_invites,
  public.tournaments, public.tournament_registrations, public.rating_history from anon, authenticated;
grant select on public.matches, public.match_moves, public.friendships, public.game_invites, public.tournaments,
  public.rating_history to anon, authenticated;
grant select on public.tournament_registrations to authenticated;
grant select on public.profiles, public.leaderboard, public.tournament_overview, public.match_view, public.match_history to anon, authenticated;

/* ----------------------------------------------------------------- realtime */
alter publication supabase_realtime add table public.profiles, public.matches, public.match_moves, public.friendships, public.game_invites;
alter table public.matches replica identity full;

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
