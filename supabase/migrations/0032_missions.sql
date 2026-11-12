-- DAMEO 0032: Missions (Kunlik topshiriqlar + Bir martalik topshiriqlar) and Telegram channel missions.
--  * Everything is computed on the server from real data (matches, referrals, Telegram getChatMember). The client only
--    asks "claim <mission>"; the amount comes from the server's own table, never from the client.
--  * Every reward needs the player to press "Olish" (claim). A claim is one row in mission_claims (unique per
--    user + mission + period) and one wallet transaction (idempotent key mission:<key>:<period>), in one transaction.
--  * Counting starts at the moment this system went live (_missions_epoch): earlier games/referrals never count.
--  * Valid rated game = the same rule as the +20 / +10 match coins (0026): finished, rated, Elo applied, ≥ 12 moves,
--    no rating note (short game / pair limit), not a practice bot. Losses and draws break a win streak.
--  * Daily missions reset at 00:00 Asia/Tashkent (server time). One-time missions: once per account, kept as history.
--  * Telegram channels: up to 3 active, each with its own reward, managed in the admin panel ("missions.manage").
--    The edge function `missions` verifies membership with getChatMember and is the only caller of the claim function.
-- Additive: new tables + functions; _admin_perms gains 'missions.manage'. Existing rewards/Elo/referrals untouched.

/* ------------------------------------------------------------ start moment */
do $$
begin
  if to_regprocedure('public._missions_epoch()') is null then
    execute format('create function public._missions_epoch() returns timestamptz language sql immutable set search_path = public as $f$ select %L::timestamptz $f$', now());
  end if;
end $$;

/* ------------------------------------------------------------ catalogue */
create or replace function public._mission_defs()
returns table (key text, kind text, target int, reward int, sort int)
language sql immutable set search_path = public as $$
  values ('d_wins3',     'daily',   3,  30, 1),   -- win 3 rated games today
         ('d_invite',    'daily',   1,  50, 2),   -- 1 genuinely new invited player today
         ('d_bot_medium','daily',   1,  20, 3),   -- beat the Medium practice bot once
         ('d_streak3',   'daily',   3,  50, 4),   -- 3 rated wins in a row today
         ('d_games5',    'daily',   5,  30, 5),   -- complete 5 rated games today
         ('d_bonus',     'bonus',   5,  60, 6),   -- all 5 daily missions completed
         ('o_games10',   'once',   10,  50, 11),
         ('o_games50',   'once',   50, 150, 12),
         ('o_games100',  'once',  100, 300, 13),
         ('o_wins50',    'once',   50, 200, 14),
         ('o_wins100',   'once',  100, 300, 15),
         ('o_wins200',   'once',  200, 500, 16);
$$;

/* ------------------------------------------------------------ tables */
create table if not exists public.mission_channels (
  id             bigserial primary key,
  chat_id        text not null,                 -- '@username' or '-100…' (what getChatMember is asked with)
  title          text not null,
  username       text,                          -- public @username (for the link and the avatar), without '@'
  invite_link    text,                          -- for private channels
  reward         int not null check (reward between 1 and 10000),
  active         boolean not null default false,
  bot_ok         boolean,                       -- last admin check: can the bot verify members?
  bot_status     text,
  bot_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz                    -- removed from DAMEO (the Telegram channel itself is untouched)
);
create unique index if not exists mission_channels_chat_uq on public.mission_channels (lower(chat_id)) where deleted_at is null;

create table if not exists public.mission_claims (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  mission     text not null,                    -- d_* / o_* / channel:<id>
  period      text not null,                    -- Tashkent day 'YYYY-MM-DD' for daily, 'once' for one-time
  reward      int not null,
  channel_id  bigint references public.mission_channels(id),
  created_at  timestamptz not null default now(),
  unique (user_id, mission, period)
);
create index if not exists mission_claims_channel_idx on public.mission_claims (channel_id) where channel_id is not null;

create table if not exists public.mission_channel_subs (
  channel_id   bigint not null references public.mission_channels(id),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  tg_id        bigint not null,
  member       boolean not null,
  status       text,
  verified_at  timestamptz not null default now(),
  rewarded_at  timestamptz,
  primary key (channel_id, user_id)
);
-- one reward per channel per Telegram account, even across several DAMEO accounts
create unique index if not exists mission_channel_subs_tg_uq on public.mission_channel_subs (channel_id, tg_id) where rewarded_at is not null;

alter table public.mission_channels enable row level security;
alter table public.mission_claims enable row level security;
alter table public.mission_channel_subs enable row level security;
revoke all on public.mission_channels, public.mission_claims, public.mission_channel_subs from anon, authenticated;
grant select, insert, update on public.mission_channels, public.mission_claims, public.mission_channel_subs to service_role;
grant usage, select on sequence public.mission_channels_id_seq, public.mission_claims_id_seq to service_role;

/* ------------------------------------------------------------ admin permission */
create or replace function public._admin_perms(p_role text) returns text[]
language sql immutable set search_path = public as $$
  select case p_role
    when 'super_admin' then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view','roles.manage',
                                  'virtual.manage','missions.manage']
    when 'admin'       then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view',
                                  'virtual.manage','missions.manage']
    when 'moderator'   then array['dashboard','users.view','users.ban','reports.view','reports.manage','chat.moderate']
    when 'support'     then array['dashboard','users.view','balance.view','payments.view','reports.view']
    else array[]::text[] end;
$$;

/* ------------------------------------------------------------ progress */
-- valid rated games of one player in [p_from, p_to) (never before the epoch); won = this player won
create or replace function public._mission_games(p_uid uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, ended_at timestamptz, won boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.ended_at, x.won from (
    select m.id, m.ended_at, m.result = 'white' as won, m.status, m.rated, m.rating_applied, m.move_count, m.rating_note, m.black_id, m.virtual_id
      from public.matches m where m.white_id = p_uid
    union all
    select m.id, m.ended_at, m.result = 'black', m.status, m.rated, m.rating_applied, m.move_count, m.rating_note, m.black_id, m.virtual_id
      from public.matches m where m.black_id = p_uid
  ) x
  where x.status = 'finished' and x.rated and x.rating_applied and coalesce(x.move_count, 0) >= 12 and x.rating_note is null
    and not (x.black_id is null and x.virtual_id is null)
    and x.ended_at >= greatest(p_from, public._missions_epoch()) and x.ended_at < p_to;
$$;

-- every mission's progress for one player right now: {key: progress}
create or replace function public._mission_progress(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := public._daily_today();
        s timestamptz := d::timestamp at time zone 'Asia/Tashkent';
        e timestamptz := (d + 1)::timestamp at time zone 'Asia/Tashkent';
        g_today int; w_today int; streak int; inv int; bot int; g_all int; w_all int;
begin
  select count(*), count(*) filter (where won) into g_today, w_today from public._mission_games(p_uid, s, e);
  -- longest run of consecutive wins today (a loss or a draw starts a new run)
  select coalesce(max(n), 0) into streak from (
    select count(*) as n from (
      select won, sum(case when won then 0 else 1 end) over (order by ended_at, id) as grp from public._mission_games(p_uid, s, e)
    ) r where won group by grp) q;
  select count(*) into inv from public.referrals r
   where r.inviter_id = p_uid and r.created_at >= greatest(s, public._missions_epoch()) and r.created_at < e;
  select count(*) into bot from public.matches m
   where m.white_id = p_uid and m.vs_bot and m.virtual_id is null and m.bot_level = 'medium'
     and m.status = 'finished' and m.result = 'white'
     and m.ended_at >= greatest(s, public._missions_epoch()) and m.ended_at < e;
  select count(*), count(*) filter (where won) into g_all, w_all from public._mission_games(p_uid, '-infinity', 'infinity');
  return jsonb_build_object(
    'd_wins3', w_today, 'd_invite', inv, 'd_bot_medium', bot, 'd_streak3', streak, 'd_games5', g_today,
    'o_games10', g_all, 'o_games50', g_all, 'o_games100', g_all, 'o_wins50', w_all, 'o_wins100', w_all, 'o_wins200', w_all);
end $$;

/* ------------------------------------------------------------ player API */
create or replace function public.missions_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); d date := public._daily_today(); p jsonb; done_n int; daily json; once json; hist json; ch json;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  p := public._mission_progress(uid);
  select count(*) into done_n from public._mission_defs() x where x.kind = 'daily' and (p ->> x.key)::int >= x.target;
  select json_agg(json_build_object('key', x.key, 'target', x.target, 'reward', x.reward,
                                    'progress', least(case when x.kind = 'bonus' then done_n else (p ->> x.key)::int end, x.target),
                                    'done', case when x.kind = 'bonus' then done_n >= 5 else (p ->> x.key)::int >= x.target end,
                                    'claimed', c.id is not null) order by x.sort)
    into daily
    from public._mission_defs() x
    left join public.mission_claims c on c.user_id = uid and c.mission = x.key and c.period = d::text
   where x.kind in ('daily', 'bonus');
  select json_agg(json_build_object('key', x.key, 'target', x.target, 'reward', x.reward,
                                    'progress', least((p ->> x.key)::int, x.target), 'done', (p ->> x.key)::int >= x.target) order by x.sort)
    into once
    from public._mission_defs() x
   where x.kind = 'once' and not exists (select 1 from public.mission_claims c where c.user_id = uid and c.mission = x.key and c.period = 'once');
  select coalesce(json_agg(json_build_object('id', ch.id, 'title', ch.title, 'username', ch.username,
                                             'link', coalesce(case when ch.username is not null then 'https://t.me/' || ch.username end, ch.invite_link),
                                             'reward', ch.reward, 'verified', coalesce(s.member, false), 'verified_at', s.verified_at) order by ch.id), '[]'::json)
    into ch
    from public.mission_channels ch
    left join public.mission_channel_subs s on s.channel_id = ch.id and s.user_id = uid
   where ch.active and ch.deleted_at is null
     and not exists (select 1 from public.mission_claims c where c.user_id = uid and c.mission = 'channel:' || ch.id and c.period = 'once');
  -- completed one-time missions (history), channels included even if the channel was removed later
  select coalesce(json_agg(json_build_object('mission', c.mission, 'reward', c.reward, 'claimed_at', c.created_at,
                                             'title', mc.title) order by c.created_at desc), '[]'::json)
    into hist
    from public.mission_claims c left join public.mission_channels mc on mc.id = c.channel_id
   where c.user_id = uid and c.period = 'once';
  return json_build_object(
    'day', d,
    'resets_at', (d + 1)::timestamp at time zone 'Asia/Tashkent',
    'server_now', clock_timestamp(),
    'balance', coalesce((select w.balance from public.user_wallets w where w.user_id = uid), 0),
    'has_telegram', exists (select 1 from public.profiles where id = uid and tg_id is not null),
    'daily', daily,
    'once', coalesce(once, '[]'::json),
    'channels', ch,
    'history', hist);
end $$;

-- "Olish": the server re-checks the mission and pays its own amount once.
create or replace function public.mission_claim(p_mission text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); x record; p jsonb; per text; prog int; done_n int; cid bigint; bal bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  perform 1 from public.profiles where id = uid for update;              -- one claim at a time per player
  select * into x from public._mission_defs() d where d.key = p_mission;
  if not found then return json_build_object('ok', false, 'reason', 'unknown'); end if;
  per := case when x.kind = 'once' then 'once' else public._daily_today()::text end;
  if exists (select 1 from public.mission_claims where user_id = uid and mission = x.key and period = per) then
    return json_build_object('ok', false, 'reason', 'claimed');
  end if;
  p := public._mission_progress(uid);
  if x.kind = 'bonus' then
    select count(*) into done_n from public._mission_defs() d where d.kind = 'daily' and (p ->> d.key)::int >= d.target;
    prog := done_n;
  else
    prog := (p ->> x.key)::int;
  end if;
  if prog < x.target then return json_build_object('ok', false, 'reason', 'not-done', 'progress', prog, 'target', x.target); end if;
  insert into public.mission_claims (user_id, mission, period, reward) values (uid, x.key, per, x.reward)
  on conflict (user_id, mission, period) do nothing returning id into cid;
  if cid is null then return json_build_object('ok', false, 'reason', 'claimed'); end if;
  bal := public._wallet_apply(uid, x.reward, 'reward', 'mission', cid::text, 'mission:' || x.key || ':' || per, x.key, null);
  return json_build_object('ok', true, 'mission', x.key, 'coins', x.reward, 'balance', bal);
end $$;

/* ------------------------------------------------------------ channel missions (edge function only) */
-- what the edge function needs to ask Telegram
create or replace function public.mission_channel_target(p_user uuid, p_channel bigint) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tg_id', (select tg_id from public.profiles where id = p_user),
    'chat_id', c.chat_id,
    'reward', c.reward,
    'active', c.active and c.deleted_at is null,
    'claimed', exists (select 1 from public.mission_claims m where m.user_id = p_user and m.mission = 'channel:' || c.id and m.period = 'once'))
  from public.mission_channels c where c.id = p_channel;
$$;

-- the result of one getChatMember check
create or replace function public.mission_channel_verified(p_user uuid, p_channel bigint, p_member boolean, p_status text) returns void
language sql security definer set search_path = public as $$
  insert into public.mission_channel_subs (channel_id, user_id, tg_id, member, status, verified_at)
  select p_channel, p_user, p.tg_id, p_member, left(p_status, 40), now() from public.profiles p where p.id = p_user and p.tg_id is not null
  on conflict (channel_id, user_id) do update set member = excluded.member, status = excluded.status, tg_id = excluded.tg_id, verified_at = now();
$$;

-- pay a channel reward: only right after a positive check (≤ 2 min), once per account and once per Telegram account
create or replace function public.mission_channel_claim(p_user uuid, p_channel bigint) returns json
language plpgsql security definer set search_path = public as $$
declare c public.mission_channels; s public.mission_channel_subs; cid bigint; bal bigint;
begin
  perform 1 from public.profiles where id = p_user for update;
  select * into c from public.mission_channels where id = p_channel for share;
  if not found or not c.active or c.deleted_at is not null then return json_build_object('ok', false, 'reason', 'inactive'); end if;
  if public._is_banned(p_user) then return json_build_object('ok', false, 'reason', 'restricted'); end if;
  select * into s from public.mission_channel_subs where channel_id = p_channel and user_id = p_user;
  if not found or not s.member or s.verified_at < now() - interval '2 minutes' then return json_build_object('ok', false, 'reason', 'not-verified'); end if;
  if exists (select 1 from public.mission_claims where user_id = p_user and mission = 'channel:' || p_channel and period = 'once')
     or exists (select 1 from public.mission_channel_subs where channel_id = p_channel and tg_id = s.tg_id and rewarded_at is not null) then
    return json_build_object('ok', false, 'reason', 'claimed');
  end if;
  insert into public.mission_claims (user_id, mission, period, reward, channel_id) values (p_user, 'channel:' || p_channel, 'once', c.reward, p_channel)
  on conflict (user_id, mission, period) do nothing returning id into cid;
  if cid is null then return json_build_object('ok', false, 'reason', 'claimed'); end if;
  update public.mission_channel_subs set rewarded_at = now() where channel_id = p_channel and user_id = p_user;
  bal := public._wallet_apply(p_user, c.reward, 'reward', 'mission', cid::text, 'mission:channel:' || p_channel || ':once', 'channel', null);
  return json_build_object('ok', true, 'coins', c.reward, 'balance', bal, 'title', c.title);
end $$;

-- the admin check of the bot's rights in a channel
create or replace function public.mission_channel_bot_status(p_channel bigint, p_ok boolean, p_status text) returns void
language sql security definer set search_path = public as $$
  update public.mission_channels set bot_ok = p_ok, bot_status = left(p_status, 120), bot_checked_at = now() where id = p_channel;
$$;

/* ------------------------------------------------------------ admin API ("Telegram kanallar") */
create or replace function public.admin_channels_list() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._admin_require('missions.manage');
  return coalesce((select json_agg(json_build_object(
      'id', c.id, 'chat_id', c.chat_id, 'title', c.title, 'username', c.username, 'invite_link', c.invite_link,
      'reward', c.reward, 'active', c.active, 'bot_ok', c.bot_ok, 'bot_status', c.bot_status, 'bot_checked_at', c.bot_checked_at,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'rewarded', (select count(*) from public.mission_claims m where m.channel_id = c.id),
      'coins_paid', (select coalesce(sum(m.reward), 0) from public.mission_claims m where m.channel_id = c.id)) order by c.id)
    from public.mission_channels c where c.deleted_at is null), '[]'::json);
end $$;

create or replace function public.admin_channel_save(p_id bigint, p_chat_id text, p_title text, p_username text, p_invite_link text,
                                                     p_reward int, p_active boolean, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('missions.manage'); r text := public._need_reason(p_reason); c public.mission_channels;
        chat text := nullif(btrim(coalesce(p_chat_id, '')), ''); uname text := nullif(regexp_replace(btrim(coalesce(p_username, '')), '^@|^https?://t\.me/', ''), '');
        n int;
begin
  if chat is null or chat !~ '^(@[A-Za-z0-9_]{4,32}|-?[0-9]{5,20})$' then raise exception 'bad chat'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or length(p_title) > 128 then raise exception 'bad title'; end if;
  if p_reward is null or p_reward < 1 or p_reward > 10000 then raise exception 'bad reward'; end if;
  if uname is not null and uname !~ '^[A-Za-z0-9_]{4,32}$' then raise exception 'bad username'; end if;
  if p_invite_link is not null and btrim(p_invite_link) <> '' and p_invite_link !~ '^https://t\.me/' then raise exception 'bad link'; end if;
  if uname is null and coalesce(btrim(p_invite_link), '') = '' then raise exception 'need link'; end if;
  lock table public.mission_channels in share row exclusive mode;                -- the 3-active limit is race-free
  if p_active then
    select count(*) into n from public.mission_channels where active and deleted_at is null and id is distinct from p_id;
    if n >= 3 then raise exception 'too many active'; end if;
  end if;
  if p_id is null then
    insert into public.mission_channels (chat_id, title, username, invite_link, reward, active)
    values (chat, btrim(p_title), uname, nullif(btrim(coalesce(p_invite_link, '')), ''), p_reward, coalesce(p_active, false))
    returning * into c;
    perform public._audit(uid, 'channel.create', 'mission_channel', c.id::text, r, to_jsonb(c));
  else
    update public.mission_channels set chat_id = chat, title = btrim(p_title), username = uname,
           invite_link = nullif(btrim(coalesce(p_invite_link, '')), ''), reward = p_reward, active = coalesce(p_active, false), updated_at = now()
     where id = p_id and deleted_at is null returning * into c;
    if not found then raise exception 'not found'; end if;
    perform public._audit(uid, 'channel.update', 'mission_channel', c.id::text, r, to_jsonb(c));
  end if;
  return json_build_object('ok', true, 'id', c.id);
exception when unique_violation then raise exception 'duplicate chat';
end $$;

-- removes the channel from DAMEO missions; claims, coins and history stay
create or replace function public.admin_channel_delete(p_id bigint, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('missions.manage'); r text := public._need_reason(p_reason);
begin
  update public.mission_channels set active = false, deleted_at = now(), updated_at = now() where id = p_id and deleted_at is null;
  if not found then raise exception 'not found'; end if;
  perform public._audit(uid, 'channel.delete', 'mission_channel', p_id::text, r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

/* ------------------------------------------------------------ grants */
revoke all on function public._missions_epoch(), public._mission_defs(), public._mission_games(uuid, timestamptz, timestamptz),
  public._mission_progress(uuid), public.missions_overview(), public.mission_claim(text),
  public.mission_channel_target(uuid, bigint), public.mission_channel_verified(uuid, bigint, boolean, text),
  public.mission_channel_claim(uuid, bigint), public.mission_channel_bot_status(bigint, boolean, text),
  public.admin_channels_list(), public.admin_channel_save(bigint, text, text, text, text, int, boolean, text),
  public.admin_channel_delete(bigint, text) from public, anon, authenticated;
grant execute on function public.missions_overview(), public.mission_claim(text), public.admin_channels_list(),
  public.admin_channel_save(bigint, text, text, text, text, int, boolean, text), public.admin_channel_delete(bigint, text) to authenticated;
grant execute on function public.mission_channel_target(uuid, bigint), public.mission_channel_verified(uuid, bigint, boolean, text),
  public.mission_channel_claim(uuid, bigint), public.mission_channel_bot_status(bigint, boolean, text) to service_role;
