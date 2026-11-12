-- DAMEO 0034: gift orders are also posted to a Telegram channel chosen in the admin panel.
--  * bot_chats: channels / groups the bot was added to (the bot's webhook records my_chat_member updates), so the
--    admin just makes the bot an admin of a channel and picks it — no chat ids to look up.
--  * gift_settings.orders_chat_id: where every new gift order is posted; the post is edited to "✅ Yuborildi" when
--    an admin confirms the order (message id kept on the order).
-- Additive: two small tables, two columns on gift_orders, functions.

create table if not exists public.bot_chats (
  chat_id     bigint primary key,
  title       text not null,
  username    text,
  type        text not null,
  status      text not null,               -- administrator / member / left / kicked …
  can_post    boolean not null default false,
  updated_at  timestamptz not null default now()
);
create table if not exists public.gift_settings (
  id               boolean primary key default true check (id),
  orders_chat_id   bigint,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);
insert into public.gift_settings (id) values (true) on conflict do nothing;
alter table public.gift_orders add column if not exists channel_chat_id bigint;
alter table public.gift_orders add column if not exists channel_msg_id bigint;

alter table public.bot_chats enable row level security;
alter table public.gift_settings enable row level security;
revoke all on public.bot_chats, public.gift_settings from anon, authenticated;
grant select, insert, update on public.bot_chats, public.gift_settings to service_role;

/* ------------------------------------------------------------ bot webhook */
create or replace function public.bot_chat_upsert(p_chat_id bigint, p_title text, p_username text, p_type text, p_status text, p_can_post boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.bot_chats (chat_id, title, username, type, status, can_post, updated_at)
  values (p_chat_id, left(coalesce(p_title, p_chat_id::text), 128), p_username, left(p_type, 20), left(p_status, 20), coalesce(p_can_post, false), now())
  on conflict (chat_id) do update set title = excluded.title, username = excluded.username, type = excluded.type,
    status = excluded.status, can_post = excluded.can_post, updated_at = now();
$$;

/* ------------------------------------------------------------ admin */
create or replace function public.admin_gift_channel() returns json
language plpgsql stable security definer set search_path = public as $$
declare cur bigint;
begin
  perform public._admin_require('shop.manage');
  select orders_chat_id into cur from public.gift_settings where id;
  return json_build_object(
    'current', (select json_build_object('chat_id', b.chat_id::text, 'title', coalesce(b.title, cur::text), 'username', b.username, 'type', b.type,
                                         'can_post', coalesce(b.can_post, false), 'status', b.status)
                  from (select cur as id) x left join public.bot_chats b on b.chat_id = x.id where cur is not null),
    'candidates', coalesce((select json_agg(json_build_object('chat_id', b.chat_id::text, 'title', b.title, 'username', b.username, 'type', b.type,
                                                              'can_post', b.can_post) order by b.updated_at desc)
                              from public.bot_chats b where b.status in ('administrator', 'creator')), '[]'::json));
end $$;

create or replace function public.admin_gift_channel_set(p_chat_id text, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason); c bigint;
begin
  if p_chat_id is null or p_chat_id = '' then
    update public.gift_settings set orders_chat_id = null, updated_at = now(), updated_by = uid where id;
    perform public._audit(uid, 'gift.channel', 'gift_settings', 'orders_chat', r, '{"chat_id": null}'::jsonb);
    return json_build_object('ok', true, 'chat_id', null);
  end if;
  if p_chat_id !~ '^-?[0-9]{5,20}$' then raise exception 'bad chat'; end if;
  c := p_chat_id::bigint;
  if not exists (select 1 from public.bot_chats where chat_id = c and status in ('administrator', 'creator') and can_post) then
    raise exception 'bot cannot post';
  end if;
  update public.gift_settings set orders_chat_id = c, updated_at = now(), updated_by = uid where id;
  perform public._audit(uid, 'gift.channel', 'gift_settings', 'orders_chat', r, jsonb_build_object('chat_id', c));
  return json_build_object('ok', true, 'chat_id', c::text);
end $$;

/* ------------------------------------------------------------ edge function `gifts` */
-- everything the channel post needs for one order (+ where to post)
create or replace function public.gift_order_notice(p_order bigint) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', o.id, 'code', o.code, 'gift', o.gift_id, 'gift_title', g.title_uz, 'emoji', g.emoji, 'price', o.price,
           'tg_id', o.tg_id::text, 'tg_username', o.tg_username, 'player', p.username, 'user_id', o.user_id, 'created_at', o.created_at,
           'status', o.status, 'delivered_at', o.delivered_at, 'delivered_by', a.username,
           'channel_chat_id', o.channel_chat_id::text, 'channel_msg_id', o.channel_msg_id,
           'target_chat_id', (select s.orders_chat_id::text from public.gift_settings s where s.id))
  from public.gift_orders o join public.gift_catalog g on g.id = o.gift_id join public.profiles p on p.id = o.user_id
  left join public.profiles a on a.id = o.delivered_by
  where o.id = p_order;
$$;
create or replace function public.gift_order_channel_msg(p_order bigint, p_chat bigint, p_msg bigint) returns void
language sql security definer set search_path = public as $$
  update public.gift_orders set channel_chat_id = p_chat, channel_msg_id = p_msg where id = p_order and channel_msg_id is null;
$$;
create or replace function public.gift_channel_target() returns text
language sql stable security definer set search_path = public as $$ select orders_chat_id::text from public.gift_settings where id $$;
-- the bot lost its rights in that chat → remember it (the admin panel then shows a warning)
create or replace function public.bot_chat_lost(p_chat bigint) returns void
language sql security definer set search_path = public as $$ update public.bot_chats set can_post = false, updated_at = now() where chat_id = p_chat $$;

revoke all on function public.bot_chat_upsert(bigint, text, text, text, text, boolean), public.admin_gift_channel(), public.admin_gift_channel_set(text, text),
  public.gift_order_notice(bigint), public.gift_order_channel_msg(bigint, bigint, bigint), public.gift_channel_target(), public.bot_chat_lost(bigint)
  from public, anon, authenticated;
grant execute on function public.admin_gift_channel(), public.admin_gift_channel_set(text, text) to authenticated;
grant execute on function public.bot_chat_upsert(bigint, text, text, text, text, boolean), public.gift_order_notice(bigint), public.gift_order_channel_msg(bigint, bigint, bigint),
  public.gift_channel_target(), public.bot_chat_lost(bigint) to service_role;
