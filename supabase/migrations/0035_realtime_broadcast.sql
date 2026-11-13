-- DAMEO 0035: live updates over Realtime Broadcast instead of postgres_changes (switchable, reversible).
-- Why: with postgres_changes, Realtime polls the database's change stream about once a second and re-checks every change
-- against every subscriber (8 extra database connections, ~1/3 of the small database's CPU). With Broadcast the database
-- only announces "something changed on topic X" (realtime.send) and Realtime fans it out — no polling, no per-row checks.
--  * Nothing about game data, ratings, coins or rules changes here: these triggers only SEND notifications.
--  * rt_settings.mode = 'changes' (old behaviour, the default) | 'broadcast'. Clients read it (rt_mode) and use one or
--    the other; the triggers only send while mode = 'broadcast'. Switching back to 'changes' restores the old path.
--  * A failing notification can never break a move, a payment or anything else (every send is wrapped).
--  * Topics: 'm:<match id>' (moves / match state / players' chat ping), 'lc:<match id>' (spectator chat ping),
--    'live' (a game started/finished), 'lb' (someone's rating changed), and a private per-user topic
--    'u:<md5(user id + server secret)>' that only the user can learn (my_rt_topic) — invites, challenges, wallet …
--    Payloads carry no private data except to that private topic; players' chat is only a ping (fetched with RLS).
-- Additive: one settings table, functions, triggers. Removing it = mode 'changes' (or dropping the triggers).

create table if not exists public.rt_settings (
  id          boolean primary key default true check (id),
  mode        text not null default 'changes' check (mode in ('changes', 'broadcast')),
  salt        text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
insert into public.rt_settings (id) values (true) on conflict do nothing;
alter table public.rt_settings enable row level security;
revoke all on public.rt_settings from anon, authenticated;
grant select, update on public.rt_settings to service_role;

create or replace function public.rt_mode() returns text
language sql stable security definer set search_path = public as $$ select mode from public.rt_settings where id $$;

create or replace function public._rt_user_topic(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'u:' || md5(p_user::text || ':' || (select salt from public.rt_settings where id));
$$;
create or replace function public.my_rt_topic() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else public._rt_user_topic(auth.uid()) end;
$$;

create or replace function public.admin_rt_mode_set(p_mode text, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage'); r text := public._need_reason(p_reason);
begin
  if p_mode not in ('changes', 'broadcast') then raise exception 'bad mode'; end if;
  update public.rt_settings set mode = p_mode, updated_at = now(), updated_by = uid where id;
  perform public._audit(uid, 'realtime.mode', 'rt_settings', 'mode', r, jsonb_build_object('mode', p_mode));
  return json_build_object('ok', true, 'mode', p_mode);
end $$;

-- the one place that sends; never raises
create or replace function public._rt_emit(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_topic is null or (select mode from public.rt_settings where id) <> 'broadcast' then return; end if;
  perform realtime.send(coalesce(p_payload, '{}'::jsonb), p_event, p_topic, false);
exception when others then
  null; -- a lost notification is recovered by the clients' re-sync; the write itself must always succeed
end $$;

/* ------------------------------------------------------------ triggers */
create or replace function public._rt_match_moves() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit('m:' || new.match_id, 'move', jsonb_build_object('ply', new.ply, 'from', new.from_sq, 'path', to_jsonb(new.path)));
  return null;
end $$;

create or replace function public._rt_matches() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    perform public._rt_emit('m:' || new.id, 'match', jsonb_build_object('status', new.status, 'move_count', new.move_count));
  end if;
  -- a real (non-bot) game became active for these players: pairing / a friend joined my room
  if new.status = 'active' and not coalesce(new.vs_bot, false)
     and (tg_op = 'INSERT' or old.black_id is distinct from new.black_id or old.status is distinct from new.status) then
    perform public._rt_emit(public._rt_user_topic(new.white_id), 'pair', jsonb_build_object('id', new.id, 'status', new.status));
    if new.black_id is not null then
      perform public._rt_emit(public._rt_user_topic(new.black_id), 'pair', jsonb_build_object('id', new.id, 'status', new.status));
    end if;
  end if;
  -- the live list: a game started or finished
  if tg_op = 'INSERT' or (old.status is distinct from new.status and new.status <> 'active') then
    perform public._rt_emit('live', 'live', '{}'::jsonb);
  end if;
  return null;
end $$;

create or replace function public._rt_challenges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit(public._rt_user_topic(new.to_id), 'challenge', '{}'::jsonb);
  if tg_op = 'UPDATE' then
    perform public._rt_emit(public._rt_user_topic(new.from_id), 'challenge_sent',
                            jsonb_build_object('id', new.id, 'status', new.status, 'match_id', new.match_id));
  end if;
  return null;
end $$;

create or replace function public._rt_game_invites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit(public._rt_user_topic(new.to_id), 'invite', jsonb_build_object('code', new.code));
  return null;
end $$;

create or replace function public._rt_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the presence heartbeat (last_seen only) is not news
  if (to_jsonb(new) - 'last_seen') is distinct from (to_jsonb(old) - 'last_seen') then
    perform public._rt_emit(public._rt_user_topic(new.id), 'me', '{}'::jsonb);
    if (new.rating, new.wins, new.losses, new.draws, new.username, new.avatar)
       is distinct from (old.rating, old.wins, old.losses, old.draws, old.username, old.avatar) then
      perform public._rt_emit('lb', 'lb', '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;

create or replace function public._rt_user_wallets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.balance is distinct from old.balance then
    perform public._rt_emit(public._rt_user_topic(new.user_id), 'wallet', jsonb_build_object('balance', new.balance));
  end if;
  return null;
end $$;

create or replace function public._rt_user_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit(public._rt_user_topic(new.user_id), 'notif',
                          jsonb_build_object('id', new.id, 'kind', new.kind, 'title', new.title, 'body', new.body));
  return null;
end $$;

create or replace function public._rt_friendships() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  perform public._rt_emit(public._rt_user_topic(r.requester_id), 'friends', '{}'::jsonb);
  perform public._rt_emit(public._rt_user_topic(r.addressee_id), 'friends', '{}'::jsonb);
  return null;
end $$;

create or replace function public._rt_live_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit('lc:' || new.match_id, 'livechat', '{}'::jsonb);   -- a ping: clients read it with RLS
  return null;
end $$;

create or replace function public._rt_match_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._rt_emit('m:' || new.match_id, 'matchchat', '{}'::jsonb);   -- a ping: only the players can read it
  return null;
end $$;

create or replace trigger rt_match_moves after insert on public.match_moves for each row execute function public._rt_match_moves();
create or replace trigger rt_matches after insert or update on public.matches for each row execute function public._rt_matches();
create or replace trigger rt_challenges after insert or update on public.challenges for each row execute function public._rt_challenges();
create or replace trigger rt_game_invites after insert on public.game_invites for each row execute function public._rt_game_invites();
create or replace trigger rt_profiles after update on public.profiles for each row execute function public._rt_profiles();
create or replace trigger rt_user_wallets after update on public.user_wallets for each row execute function public._rt_user_wallets();
create or replace trigger rt_user_notifications after insert on public.user_notifications for each row execute function public._rt_user_notifications();
create or replace trigger rt_friendships after insert or update or delete on public.friendships for each row execute function public._rt_friendships();
create or replace trigger rt_live_chat after insert on public.live_chat_messages for each row execute function public._rt_live_chat();
create or replace trigger rt_match_chat after insert on public.match_chat_messages for each row execute function public._rt_match_chat();

revoke all on function public.rt_mode(), public._rt_user_topic(uuid), public.my_rt_topic(), public.admin_rt_mode_set(text, text),
  public._rt_emit(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rt_mode() to anon, authenticated;
grant execute on function public.my_rt_topic(), public.admin_rt_mode_set(text, text) to authenticated;
