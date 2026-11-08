-- DAMEO 0024: admin broadcast to everyone who uses the bot.
--  * bot_subscribers: every private chat that pressed /start (the bot records it from now on) plus every player who
--    signed in to the Mini App with Telegram (backfilled from profiles.tg_id). Users who blocked the bot are marked.
--  * broadcasts + broadcast_deliveries: one row per recipient, so each person gets a broadcast at most once and an
--    interrupted send continues where it stopped. Counters are kept on the broadcast.
--  * Only super admins (roles.manage) can create/send/cancel. The sending itself happens in the `broadcast` Edge
--    Function with the bot token (Supabase secret), never in the browser; the helpers it uses are service-role only.
-- Additive only.

create table if not exists public.bot_subscribers (
  tg_id        bigint primary key,
  first_name   text,
  username     text,
  lang         text,
  source       text not null default 'start' check (source in ('start', 'app')),
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  blocked      boolean not null default false,
  blocked_at   timestamptz
);
insert into public.bot_subscribers (tg_id, first_name, source)
select p.tg_id, p.username, 'app' from public.profiles p where p.tg_id is not null
on conflict (tg_id) do nothing;

create table if not exists public.broadcasts (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.profiles(id) on delete set null,
  text        text not null check (length(text) between 1 and 4000),
  with_button boolean not null default true,
  reason      text,
  status      text not null default 'sending' check (status in ('sending', 'done', 'cancelled')),
  total       int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  blocked     int not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.broadcast_deliveries (
  broadcast_id bigint not null references public.broadcasts(id) on delete cascade,
  tg_id        bigint not null,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'blocked')),
  error        text,
  updated_at   timestamptz not null default now(),
  primary key (broadcast_id, tg_id)
);
create index if not exists broadcast_deliveries_pending_idx on public.broadcast_deliveries (broadcast_id, status);

alter table public.bot_subscribers enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_deliveries enable row level security;
revoke all on public.bot_subscribers, public.broadcasts, public.broadcast_deliveries from anon, authenticated;
grant select, insert, update on public.bot_subscribers, public.broadcasts, public.broadcast_deliveries to service_role;

/* ---------------------------------------------------------------- the bot records chats (service role) */
create or replace function public.bot_subscriber_touch(p_tg bigint, p_first text, p_username text, p_lang text) returns void
language sql security definer set search_path = public as $$
  insert into public.bot_subscribers (tg_id, first_name, username, lang, source)
  values (p_tg, left(p_first, 64), left(p_username, 64), left(p_lang, 8), 'start')
  on conflict (tg_id) do update set first_name = excluded.first_name, username = excluded.username, lang = excluded.lang,
                                    last_seen_at = now(), blocked = false, blocked_at = null;
$$;

/* ---------------------------------------------------------------- admin (super admin) */
create or replace function public.admin_broadcast_audience() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage');
begin
  return json_build_object('total', (select count(*) from public.bot_subscribers),
                           'reachable', (select count(*) from public.bot_subscribers where not blocked),
                           'blocked', (select count(*) from public.bot_subscribers where blocked),
                           'my_tg', (select tg_id from public.profiles where id = uid));
end $$;

create or replace function public.admin_broadcast_create(p_text text, p_with_button boolean, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage'); r text := public._need_reason(p_reason); b public.broadcasts; n int;
begin
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 4000 then raise exception 'bad text'; end if;
  if exists (select 1 from public.broadcasts where status = 'sending' and created_at > now() - interval '1 day') then
    raise exception 'another broadcast is still sending';
  end if;
  insert into public.broadcasts (admin_id, text, with_button, reason) values (uid, p_text, coalesce(p_with_button, true), r) returning * into b;
  insert into public.broadcast_deliveries (broadcast_id, tg_id) select b.id, s.tg_id from public.bot_subscribers s where not s.blocked;
  get diagnostics n = row_count;
  update public.broadcasts set total = n, status = case when n = 0 then 'done' else 'sending' end, finished_at = case when n = 0 then now() end where id = b.id;
  perform public._audit(uid, 'broadcast.create', 'broadcast', b.id::text, r, jsonb_build_object('recipients', n, 'chars', length(p_text)));
  return json_build_object('ok', true, 'id', b.id, 'total', n);
end $$;

create or replace function public.admin_broadcast_get(p_id bigint) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage');
begin
  return (select row_to_json(x) from (
    select b.id, b.text, b.with_button, b.status, b.total, b.sent, b.failed, b.blocked, b.created_at, b.finished_at,
           (select count(*) from public.broadcast_deliveries d where d.broadcast_id = b.id and d.status in ('pending', 'sending')) as remaining,
           (select username from public.profiles where id = b.admin_id) as admin
      from public.broadcasts b where b.id = p_id) x);
end $$;

create or replace function public.admin_broadcast_list() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage');
begin
  return (select coalesce(json_agg(row_to_json(x) order by x.id desc), '[]'::json) from (
    select b.id, left(b.text, 200) as text, b.status, b.total, b.sent, b.failed, b.blocked, b.created_at, b.finished_at,
           (select count(*) from public.broadcast_deliveries d where d.broadcast_id = b.id and d.status in ('pending', 'sending')) as remaining,
           (select username from public.profiles where id = b.admin_id) as admin
      from public.broadcasts b order by b.id desc limit 30) x);
end $$;

create or replace function public.admin_broadcast_cancel(p_id bigint, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage'); r text := public._need_reason(p_reason);
begin
  update public.broadcasts set status = 'cancelled', finished_at = now() where id = p_id and status = 'sending';
  perform public._audit(uid, 'broadcast.cancel', 'broadcast', p_id::text, r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

/* ---------------------------------------------------------------- sender helpers (service role, used by the Edge Function) */
-- next recipients; rows stuck in 'sending' for > 5 min (a crashed run) are picked up again
create or replace function public.broadcast_claim(p_id bigint, p_n int) returns table (tg_id bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.broadcasts where id = p_id and status = 'sending') then return; end if;
  return query
  update public.broadcast_deliveries d set status = 'sending', updated_at = now()
   where (d.broadcast_id, d.tg_id) in (
     select x.broadcast_id, x.tg_id from public.broadcast_deliveries x
      where x.broadcast_id = p_id and (x.status = 'pending' or (x.status = 'sending' and x.updated_at < now() - interval '5 minutes'))
      order by x.tg_id limit greatest(1, least(p_n, 100)) for update skip locked)
  returning d.tg_id;
end $$;

create or replace function public.broadcast_mark(p_id bigint, p_tg bigint, p_status text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'failed', 'blocked', 'pending') then raise exception 'bad status'; end if;
  update public.broadcast_deliveries set status = p_status, error = left(p_error, 300), updated_at = now()
   where broadcast_id = p_id and tg_id = p_tg and status = 'sending';
  if not found then return; end if;
  if p_status = 'blocked' then update public.bot_subscribers set blocked = true, blocked_at = now() where tg_id = p_tg; end if;
  update public.broadcasts set sent = sent + (p_status = 'sent')::int, failed = failed + (p_status = 'failed')::int, blocked = blocked + (p_status = 'blocked')::int
   where id = p_id;
  if not exists (select 1 from public.broadcast_deliveries where broadcast_id = p_id and status in ('pending', 'sending')) then
    update public.broadcasts set status = 'done', finished_at = now() where id = p_id and status = 'sending';
  end if;
end $$;

revoke all on function public.bot_subscriber_touch(bigint, text, text, text), public.admin_broadcast_audience(), public.admin_broadcast_create(text, boolean, text),
  public.admin_broadcast_get(bigint), public.admin_broadcast_list(), public.admin_broadcast_cancel(bigint, text),
  public.broadcast_claim(bigint, int), public.broadcast_mark(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_broadcast_audience(), public.admin_broadcast_create(text, boolean, text), public.admin_broadcast_get(bigint),
  public.admin_broadcast_list(), public.admin_broadcast_cancel(bigint, text) to authenticated;
grant execute on function public.bot_subscriber_touch(bigint, text, text, text), public.broadcast_claim(bigint, int), public.broadcast_mark(bigint, bigint, text, text) to service_role;
