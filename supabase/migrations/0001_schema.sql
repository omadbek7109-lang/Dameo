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
