-- DAMEO 0013: live spectating, spectator chat, in-game chat & emotes, draw offers, rematches, blocking.
--
-- Privacy: a game is public unless it is a private room game or one of the players hides their games.
-- The read policies of matches / match_moves now also require is_public for outsiders (players always see their own
-- games), so private games never reach spectators — neither through the API nor through Realtime.
-- Chats: the players' match chat is visible to the two players only; the spectators' live chat is separate and is NOT
-- readable by the players while their game is running (no kibitzing). All messages are written by server functions
-- with rate limits, length limits, duplicate checks, mutes and blocks.

/* ================================================================= visibility */
alter table public.profiles add column if not exists hide_games boolean not null default false;
grant update (hide_games) on public.profiles to authenticated;           -- own row only (existing RLS policy)
alter table public.matches add column if not exists is_public boolean not null default true;
create index if not exists matches_live_idx on public.matches (status, is_public, started_at desc);

create or replace function public._match_visibility() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is not null
     or exists (select 1 from public.profiles where id in (new.white_id, new.black_id) and hide_games) then
    new.is_public := false;
  end if;
  return new;
end $$;
create trigger matches_visibility before insert on public.matches for each row execute function public._match_visibility();
-- (black joining a private room keeps it private; the trigger above only decides at creation)
update public.matches set is_public = false where code is not null and is_public;

alter policy matches_read on public.matches
  using ((status in ('active', 'finished') and is_public) or white_id = auth.uid() or black_id = auth.uid());
alter policy match_moves_read on public.match_moves
  using (exists (select 1 from public.matches m where m.id = match_id
                 and ((m.status in ('active', 'finished') and m.is_public) or auth.uid() in (m.white_id, m.black_id))));

-- a player can hide their running/finished game at any time (only the players can make it public again, and only if
-- neither of them hides their games)
create or replace function public.match_set_visibility(p_match uuid, p_public boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or uid not in (m.white_id, coalesce(m.black_id, m.white_id)) then raise exception 'match not found'; end if;
  if p_public and (m.code is not null or exists (select 1 from public.profiles where id in (m.white_id, m.black_id) and hide_games)) then
    raise exception 'cannot be public';
  end if;
  update public.matches set is_public = p_public where id = m.id;
  return json_build_object('ok', true, 'is_public', p_public);
end $$;

/* ================================================================= blocking */
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
create policy user_blocks_own on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
grant select, insert, update on public.user_blocks to service_role;

create or replace function public.block_user(p_user uuid, p_block boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_user = uid then raise exception 'cannot block yourself'; end if;
  if p_block then
    insert into public.user_blocks (blocker_id, blocked_id) values (uid, p_user) on conflict do nothing;
    update public.challenges set status = 'cancelled', responded_at = now()
     where status = 'pending' and ((from_id = p_user and to_id = uid) or (from_id = uid and to_id = p_user));
  else
    -- unblock: keep the row for history? no — an unblock removes the relation; done without DELETE via a tombstone flag
    update public.user_blocks set created_at = 'epoch' where blocker_id = uid and blocked_id = p_user;
  end if;
  return json_build_object('ok', true);
end $$;
-- an "unblocked" row has created_at = epoch
create or replace function public._is_blocked(p_blocker uuid, p_blocked uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks where blocker_id = p_blocker and blocked_id = p_blocked and created_at > 'epoch');
$$;
create or replace function public.blocked_users()
returns table (user_id uuid, username text, avatar text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, p.username, p.avatar, b.created_at
  from public.user_blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid() and b.created_at > 'epoch' order by b.created_at desc;
$$;
-- blocked players cannot challenge you
create or replace function public._guard_blocked_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._is_blocked(new.to_id, new.from_id) then raise exception 'player unavailable' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger challenges_guard_blocked before insert on public.challenges for each row execute function public._guard_blocked_challenge();

/* ================================================================= spam guard (shared) */
create or replace function public._chat_guard(p_uid uuid, p_body text, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare b text := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
begin
  if p_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if public._is_banned(p_uid) then raise exception 'account restricted'; end if;
  if (select muted_until > now() from public.profiles where id = p_uid) then raise exception 'muted'; end if;
  if p_kind = 'emoji' then
    if b not in ('😂', '🔥', '👏', '😮', '😎', '🤝', '❤️') then raise exception 'bad emoji'; end if;
  elsif p_kind = 'text' then
    if length(b) < 1 or length(b) > 200 then raise exception 'bad length'; end if;
  end if;
  return b;
end $$;

/* ================================================================= players' match chat */
create table if not exists public.match_chat_messages (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('text', 'emoji', 'draw_offer', 'draw_accept', 'draw_decline', 'rematch_offer', 'rematch_accept', 'rematch_decline')),
  body       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists match_chat_idx on public.match_chat_messages (match_id, id);
create index if not exists match_chat_user_idx on public.match_chat_messages (user_id, created_at desc);
alter table public.match_chat_messages enable row level security;
create policy match_chat_players on public.match_chat_messages for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.white_id, m.black_id))
         and not exists (select 1 from public.user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = user_id and b.created_at > 'epoch'));
revoke all on public.match_chat_messages from anon, authenticated;
grant select on public.match_chat_messages to authenticated;
grant select, insert on public.match_chat_messages to service_role;
alter publication supabase_realtime add table public.match_chat_messages;

create or replace function public.match_chat_send(p_match uuid, p_kind text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; b text; n int;
begin
  if p_kind not in ('text', 'emoji') then raise exception 'bad kind'; end if;
  b := public._chat_guard(uid, p_body, p_kind);
  select * into m from public.matches where id = p_match;
  if not found or m.black_id is null or uid not in (m.white_id, m.black_id) then raise exception 'match not found'; end if;
  if m.status = 'finished' and m.ended_at < now() - interval '10 minutes' then raise exception 'chat closed'; end if;
  if exists (select 1 from public.match_chat_messages where user_id = uid and created_at > now() - interval '1 second') then raise exception 'slow down'; end if;
  select count(*) into n from public.match_chat_messages where user_id = uid and created_at > now() - interval '1 minute';
  if n >= 20 then raise exception 'slow down'; end if;
  if p_kind = 'text' and exists (select 1 from public.match_chat_messages where user_id = uid and match_id = p_match and body = b and created_at > now() - interval '20 seconds') then
    raise exception 'duplicate';
  end if;
  insert into public.match_chat_messages (match_id, user_id, kind, body) values (p_match, uid, p_kind, b);
  return json_build_object('ok', true);
end $$;

-- draw offer → the opponent accepts (game ends as a draw, rating applied once) or declines
create or replace function public.match_offer_draw(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found or m.black_id is null or uid not in (m.white_id, m.black_id) then raise exception 'match not found'; end if;
  if m.status <> 'active' then raise exception 'not active'; end if;
  if (select count(*) from public.match_chat_messages where match_id = p_match and user_id = uid and kind = 'draw_offer') >= 3 then raise exception 'too many offers'; end if;
  if exists (select 1 from public.match_chat_messages where match_id = p_match and user_id = uid and kind = 'draw_offer' and created_at > now() - interval '30 seconds') then
    raise exception 'slow down';
  end if;
  insert into public.match_chat_messages (match_id, user_id, kind) values (p_match, uid, 'draw_offer');
  return json_build_object('ok', true);
end $$;

create or replace function public.match_respond_draw(p_match uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; offer public.match_chat_messages;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.black_id is null or uid not in (m.white_id, m.black_id) then raise exception 'match not found'; end if;
  if m.status <> 'active' then raise exception 'not active'; end if;
  select * into offer from public.match_chat_messages where match_id = p_match and kind = 'draw_offer' order by id desc limit 1;
  if not found or offer.user_id = uid or offer.created_at < now() - interval '2 minutes'
     or exists (select 1 from public.match_chat_messages where match_id = p_match and id > offer.id and kind in ('draw_accept', 'draw_decline')) then
    raise exception 'no open offer';
  end if;
  insert into public.match_chat_messages (match_id, user_id, kind) values (p_match, uid, case when p_accept then 'draw_accept' else 'draw_decline' end);
  if p_accept then
    update public.matches set status = 'finished', result = 'draw', result_reason = 'agreement', ended_at = now() where id = m.id;
    if m.rated then perform public.apply_match_result(m.id); end if;
  end if;
  return json_build_object('ok', true, 'accepted', p_accept);
end $$;

-- rematch: after a player-vs-player game the opponent can accept → a new game with swapped colours and the same clock
create or replace function public.match_offer_rematch(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found or m.black_id is null or m.vs_bot or uid not in (m.white_id, m.black_id) then raise exception 'match not found'; end if;
  if m.status <> 'finished' or m.ended_at < now() - interval '10 minutes' then raise exception 'not available'; end if;
  if exists (select 1 from public.match_chat_messages where match_id = p_match and kind = 'rematch_accept') then raise exception 'already accepted'; end if;
  if exists (select 1 from public.match_chat_messages where match_id = p_match and user_id = uid and kind = 'rematch_offer' and created_at > now() - interval '20 seconds') then
    raise exception 'slow down';
  end if;
  insert into public.match_chat_messages (match_id, user_id, kind) values (p_match, uid, 'rematch_offer');
  return json_build_object('ok', true);
end $$;

create or replace function public.match_respond_rematch(p_match uuid, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; offer public.match_chat_messages; n public.matches;
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
  insert into public.matches (white_id, black_id, status, rated, started_at, time_control, white_ms, black_ms, turn_started_at)
  values (m.black_id, m.white_id, 'active', m.rated, now(), m.time_control,
          case when m.time_control is null then null else m.time_control * 1000 end,
          case when m.time_control is null then null else m.time_control * 1000 end,
          case when m.time_control is null then null else now() end)
  returning * into n;
  insert into public.match_chat_messages (match_id, user_id, kind, data) values (p_match, uid, 'rematch_accept', jsonb_build_object('match_id', n.id));
  return json_build_object('ok', true, 'match_id', n.id);
end $$;

/* ================================================================= spectators */
create table if not exists public.live_viewers (
  match_id  uuid not null references public.matches(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index if not exists live_viewers_seen_idx on public.live_viewers (last_seen desc);
alter table public.live_viewers enable row level security;
revoke all on public.live_viewers from anon, authenticated;
grant select, insert, update on public.live_viewers to service_role;

-- heartbeat every ~20 s while watching; returns the current number of viewers
create or replace function public.live_ping(p_match uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found or not m.is_public then raise exception 'not found'; end if;
  if uid is not null and uid not in (m.white_id, coalesce(m.black_id, m.white_id)) and m.status = 'active' then
    insert into public.live_viewers (match_id, user_id, last_seen) values (p_match, uid, now())
    on conflict (match_id, user_id) do update set last_seen = now();
  end if;
  return json_build_object('viewers', (select count(*) from public.live_viewers where match_id = p_match and last_seen > now() - interval '45 seconds'),
                           'status', m.status);
end $$;

create or replace function public.live_stats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'games', (select count(*) from public.matches where status = 'active' and is_public and started_at > now() - interval '6 hours'),
    'viewers', (select count(distinct user_id) from public.live_viewers v join public.matches m on m.id = v.match_id
                 where v.last_seen > now() - interval '45 seconds' and m.status = 'active'));
$$;

-- public running games (newest first) with players, mode, viewers and the moves so far (the client replays them)
create or replace function public.live_list(p_limit int default 20, p_offset int default 0) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select m.id, m.started_at, m.move_count, m.time_control, m.vs_bot, m.bot_level, m.rated,
           m.white_ms, m.black_ms, m.turn_started_at,
           wp.username as white_name, wp.avatar as white_avatar, wp.rating as white_rating,
           coalesce(bp.username, case when m.vs_bot then 'DAMEO Bot' end) as black_name, bp.avatar as black_avatar,
           coalesce(bp.rating, case when m.vs_bot then 1200 end) as black_rating,
           (select count(*) from public.live_viewers v where v.match_id = m.id and v.last_seen > now() - interval '45 seconds') as viewers,
           (select coalesce(json_agg(json_build_array(mm.from_sq, mm.path) order by mm.ply), '[]'::json) from public.match_moves mm where mm.match_id = m.id) as moves
    from public.matches m
    join public.profiles wp on wp.id = m.white_id
    left join public.profiles bp on bp.id = m.black_id
    where m.status = 'active' and m.is_public and m.started_at > now() - interval '6 hours'
    order by (select count(*) from public.live_viewers v where v.match_id = m.id and v.last_seen > now() - interval '45 seconds') desc,
             (coalesce(wp.rating, 0) + coalesce(bp.rating, 0)) desc, m.started_at desc
    limit greatest(1, least(p_limit, 50)) offset greatest(0, p_offset)) x;
$$;

-- notable finished public games of the last 7 days (strongest players, longest fights) → "Chiroyli o'yinlar"
create or replace function public.featured_games(p_limit int default 20) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select m.id, m.ended_at, m.move_count, m.result, m.result_reason, m.time_control,
           wp.username as white_name, wp.avatar as white_avatar, wp.rating as white_rating,
           bp.username as black_name, bp.avatar as black_avatar, bp.rating as black_rating
    from public.matches m join public.profiles wp on wp.id = m.white_id join public.profiles bp on bp.id = m.black_id
    where m.status = 'finished' and m.is_public and not m.vs_bot and m.move_count >= 20 and m.ended_at > now() - interval '7 days'
    order by (wp.rating + bp.rating) desc, m.move_count desc limit greatest(1, least(p_limit, 50))) x;
$$;

-- my finished games (archive), newest first, keyset by ended_at
create or replace function public.my_games(p_before timestamptz default null, p_limit int default 20) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select m.id, m.ended_at, m.move_count, m.result, m.result_reason, m.vs_bot, m.bot_level, m.time_control, m.rated,
           m.white_id, m.black_id, m.white_delta, m.black_delta, m.is_public,
           wp.username as white_name, coalesce(bp.username, case when m.vs_bot then 'DAMEO Bot' end) as black_name
    from public.matches m join public.profiles wp on wp.id = m.white_id left join public.profiles bp on bp.id = m.black_id
    where (m.white_id = auth.uid() or m.black_id = auth.uid()) and m.status = 'finished'
      and (p_before is null or m.ended_at < p_before)
    order by m.ended_at desc limit greatest(1, least(p_limit, 50))) x;
$$;

/* ================================================================= spectators' live chat */
create table if not exists public.live_chat_messages (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('text', 'emoji')),
  body       text not null,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists live_chat_idx on public.live_chat_messages (match_id, id);
create index if not exists live_chat_user_idx on public.live_chat_messages (user_id, created_at desc);
alter table public.live_chat_messages enable row level security;
-- readable for public games; the two players cannot read it while their game is running
create policy live_chat_read on public.live_chat_messages for select to anon, authenticated
  using (not hidden and exists (select 1 from public.matches m where m.id = match_id and m.is_public
                                and (m.status <> 'active' or auth.uid() is null or auth.uid() not in (m.white_id, coalesce(m.black_id, m.white_id)))));
revoke all on public.live_chat_messages from anon, authenticated;
grant select on public.live_chat_messages to anon, authenticated;
grant select, insert, update on public.live_chat_messages to service_role;
alter publication supabase_realtime add table public.live_chat_messages;

create or replace function public.live_chat_send(p_match uuid, p_kind text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.matches; b text; n int;
begin
  if p_kind not in ('text', 'emoji') then raise exception 'bad kind'; end if;
  b := public._chat_guard(uid, p_body, p_kind);
  select * into m from public.matches where id = p_match;
  if not found or not m.is_public then raise exception 'match not found'; end if;
  if m.status = 'active' and uid in (m.white_id, coalesce(m.black_id, m.white_id)) then raise exception 'players cannot use the live chat'; end if;
  if m.status = 'finished' and m.ended_at < now() - interval '30 minutes' then raise exception 'chat closed'; end if;
  if exists (select 1 from public.live_chat_messages where user_id = uid and created_at > now() - interval '2 seconds') then raise exception 'slow down'; end if;
  select count(*) into n from public.live_chat_messages where user_id = uid and created_at > now() - interval '1 minute';
  if n >= 15 then raise exception 'slow down'; end if;
  if p_kind = 'text' and exists (select 1 from public.live_chat_messages where user_id = uid and body = b and created_at > now() - interval '30 seconds') then
    raise exception 'duplicate';
  end if;
  insert into public.live_chat_messages (match_id, user_id, kind, body) values (p_match, uid, p_kind, b);
  return json_build_object('ok', true);
end $$;

create or replace function public.live_chat_recent(p_match uuid, p_limit int default 50)
returns table (id bigint, user_id uuid, username text, avatar text, kind text, body text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select c.id, c.user_id, p.username, p.avatar, c.kind, c.body, c.created_at
  from public.live_chat_messages c join public.profiles p on p.id = c.user_id
  where c.match_id = p_match
  order by c.id desc limit greatest(1, least(p_limit, 100));
$$;

-- moderation: hide one spectator message (moderators / admins)
create or replace function public.admin_chat_hide(p_message bigint, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('chat.moderate'); r text := public._need_reason(p_reason); who uuid;
begin
  update public.live_chat_messages set hidden = true where id = p_message returning user_id into who;
  if not found then raise exception 'message not found'; end if;
  perform public._audit(uid, 'chat.hide', 'user', who::text, r, jsonb_build_object('message', p_message));
  return json_build_object('ok', true);
end $$;

/* ================================================================= admin dashboard: live numbers */
create or replace function public.admin_dashboard() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('dashboard'); today timestamptz := date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
begin
  return json_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_online', (select count(*) from public.profiles where last_seen > now() - interval '2 minutes'),
    'users_today', (select count(*) from public.profiles where created_at >= today),
    'games_active', (select count(*) from public.matches where status = 'active'),
    'games_today', (select count(*) from public.matches where created_at >= today and status in ('active', 'finished')),
    'live_games', (select count(*) from public.matches where status = 'active' and is_public and started_at > now() - interval '6 hours'),
    'live_viewers', (select count(distinct user_id) from public.live_viewers where last_seen > now() - interval '45 seconds'),
    'payments_paid', (select count(*) from public.payment_orders where status = 'paid'),
    'stars_today', (select coalesce(sum(stars), 0) from public.payment_orders where status = 'paid' and paid_at >= today),
    'stars_total', (select coalesce(sum(stars), 0) from public.payment_orders where status = 'paid'),
    'coins_circulation', (select coalesce(sum(balance), 0) from public.user_wallets),
    'purchases_today', (select count(*) from public.shop_purchases where created_at >= today),
    'reports_open', (select count(*) from public.reports where status in ('open', 'in_review')),
    'banned', (select count(*) from public.profiles where banned_until > now()),
    'server_now', now());
end $$;

/* ================================================================= grants */
revoke all on function public._match_visibility(), public.match_set_visibility(uuid, boolean), public.block_user(uuid, boolean),
  public._is_blocked(uuid, uuid), public.blocked_users(), public._guard_blocked_challenge(), public._chat_guard(uuid, text, text),
  public.match_chat_send(uuid, text, text), public.match_offer_draw(uuid), public.match_respond_draw(uuid, boolean),
  public.match_offer_rematch(uuid), public.match_respond_rematch(uuid, boolean), public.live_ping(uuid), public.live_stats(),
  public.live_list(int, int), public.featured_games(int), public.my_games(timestamptz, int), public.live_chat_send(uuid, text, text),
  public.live_chat_recent(uuid, int), public.admin_chat_hide(bigint, text)
from public, anon, authenticated;
grant execute on function public.match_set_visibility(uuid, boolean), public.block_user(uuid, boolean), public.blocked_users(),
  public.match_chat_send(uuid, text, text), public.match_offer_draw(uuid), public.match_respond_draw(uuid, boolean),
  public.match_offer_rematch(uuid), public.match_respond_rematch(uuid, boolean), public.my_games(timestamptz, int),
  public.live_chat_send(uuid, text, text), public.admin_chat_hide(bigint, text) to authenticated;
grant execute on function public.live_ping(uuid), public.live_stats(), public.live_list(int, int), public.featured_games(int),
  public.live_chat_recent(uuid, int) to anon, authenticated;

/* ================================================================= match_view: + is_public (appended) */
create or replace view public.match_view with (security_invoker = true) as
  select m.id,
         case when auth.uid() in (m.white_id, m.black_id) then m.code end as code,
         m.white_id, m.black_id, m.status, m.result, m.result_reason, m.rated, m.move_count, m.created_at,
         wp.username as white_name, wp.rating as white_rating,
         coalesce(bp.username, case when m.vs_bot then 'DAMEO Bot' end) as black_name,
         coalesce(bp.rating, case when m.vs_bot then 1200 end) as black_rating,
         m.vs_bot, m.bot_level,
         m.time_control, m.white_ms, m.black_ms, m.turn_started_at, m.timeout_kind, clock_timestamp() as server_now,
         m.is_public
  from public.matches m
  join public.profiles wp on wp.id = m.white_id
  left join public.profiles bp on bp.id = m.black_id;
