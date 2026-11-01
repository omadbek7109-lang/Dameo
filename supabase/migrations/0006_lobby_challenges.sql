-- DAMEO 0006: visible lobby, heartbeat-based matchmaking queue, and player-to-player challenges.
-- Note: no DELETE statements — queue rows are kept (one per player) and marked stale instead.

/* ------------------------------------------------------------ queue heartbeat */
alter table public.matchmaking_queue add column if not exists last_seen timestamptz not null default now();

-- A player is "searching" while their client pings quick_match (every few seconds). 15 s without a ping = gone.
create or replace function public.quick_match() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.profiles; other public.matchmaking_queue; m public.matches; flip boolean;
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
    last_seen = now();
  return json_build_object('match_id', null);
end $$;

create or replace function public.cancel_quick_match() returns void
language sql security definer set search_path = public as $$
  update public.matchmaking_queue set last_seen = '-infinity' where user_id = auth.uid();
$$;

/* ------------------------------------------------------------------- lobby */
-- Who is searching right now (public profile data only).
create or replace function public.lobby()
returns table (id uuid, username text, avatar text, rating int, waiting_seconds int)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.avatar, p.rating, greatest(0, extract(epoch from (now() - q.created_at)))::int
  from public.matchmaking_queue q join public.profiles p on p.id = q.user_id
  where q.last_seen > now() - interval '15 seconds' and q.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  order by q.created_at limit 30;
$$;

create or replace function public.lobby_stats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'online', (select count(*) from public.profiles where last_seen > now() - interval '2 minutes'),
    'searching', (select count(*) from public.matchmaking_queue where last_seen > now() - interval '15 seconds'));
$$;

/* --------------------------------------------------------------- challenges */
create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  from_id      uuid not null references public.profiles(id) on delete cascade,
  to_id        uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  match_id     uuid references public.matches(id) on delete set null,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint challenge_not_self check (from_id <> to_id)
);
create index challenges_to_idx on public.challenges (to_id, status, created_at desc);
create index challenges_from_idx on public.challenges (from_id, status, created_at desc);
alter table public.challenges enable row level security;
create policy challenges_read_own on public.challenges for select to authenticated using (auth.uid() in (from_id, to_id));
revoke all on public.challenges from anon, authenticated;
grant select on public.challenges to authenticated;
grant select, insert, update, delete on public.challenges to service_role;
alter publication supabase_realtime add table public.challenges;
alter table public.challenges replica identity full;

-- Send a challenge (one outstanding challenge per sender; target must be online). Expires after 60 s.
create or replace function public.send_challenge(p_to uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.challenges;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_to = uid then raise exception 'cannot challenge yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_to and last_seen > now() - interval '2 minutes') then
    raise exception 'player offline';
  end if;
  if exists (select 1 from public.challenges where from_id = uid and created_at > now() - interval '3 seconds') then
    raise exception 'too many challenges';
  end if;
  update public.challenges set status = 'cancelled', responded_at = now() where from_id = uid and status = 'pending';
  insert into public.challenges (from_id, to_id) values (uid, p_to) returning * into c;
  return json_build_object('challenge_id', c.id);
end $$;

create or replace function public.cancel_challenge(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.challenges set status = 'cancelled', responded_at = now() where id = p_id and from_id = auth.uid() and status = 'pending';
$$;

-- Accept → creates a rated game with random colours; decline → sender is told.
create or replace function public.respond_challenge(p_id uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.challenges; m public.matches; flip boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into c from public.challenges where id = p_id and to_id = uid for update;
  if not found then raise exception 'challenge not found'; end if;
  if c.status <> 'pending' then raise exception 'challenge %', c.status; end if;
  if c.created_at < now() - interval '60 seconds' then
    update public.challenges set status = 'cancelled', responded_at = now() where id = c.id;
    raise exception 'challenge expired';
  end if;
  if not p_accept then
    update public.challenges set status = 'declined', responded_at = now() where id = c.id;
    return json_build_object('match_id', null);
  end if;
  flip := random() < 0.5;
  insert into public.matches (white_id, black_id, status, rated, started_at)
  values (case when flip then c.from_id else uid end, case when flip then uid else c.from_id end, 'active', true, now())
  returning * into m;
  update public.challenges set status = 'accepted', responded_at = now(), match_id = m.id where id = c.id;
  -- both players leave the queue and any other open challenges
  update public.matchmaking_queue set last_seen = '-infinity' where user_id in (uid, c.from_id);
  update public.challenges set status = 'cancelled', responded_at = now()
   where status = 'pending' and id <> c.id and (from_id in (uid, c.from_id) or to_id in (uid, c.from_id));
  return json_build_object('match_id', m.id);
end $$;

-- Pending challenges addressed to me (shown when the app opens).
create or replace function public.incoming_challenges()
returns table (id uuid, from_id uuid, username text, avatar text, rating int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.from_id, p.username, p.avatar, p.rating, c.created_at
  from public.challenges c join public.profiles p on p.id = c.from_id
  where c.to_id = auth.uid() and c.status = 'pending' and c.created_at > now() - interval '60 seconds'
  order by c.created_at desc limit 5;
$$;

revoke execute on function public.lobby(), public.lobby_stats(), public.send_challenge(uuid), public.cancel_challenge(uuid),
  public.respond_challenge(uuid, boolean), public.incoming_challenges() from public, anon;
grant execute on function public.lobby(), public.lobby_stats(), public.send_challenge(uuid), public.cancel_challenge(uuid),
  public.respond_challenge(uuid, boolean), public.incoming_challenges() to authenticated;
