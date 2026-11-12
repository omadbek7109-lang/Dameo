-- DAMEO 0033: Telegram Gifts in the Shop (Bear, Heart, Rose, Gift Box) paid with DAMEO Coins.
--  * Prices live here (gift_catalog); the client only sends the gift id and a one-time purchase key.
--  * One purchase = one gift_orders row + one wallet debit, in one transaction. Retrying with the same key returns the
--    same order (no double charge). Each order gets a unique 4-digit code that is never reused.
--  * Only Telegram accounts can buy (the order keeps the buyer's Telegram id; the @username comes from the signed
--    Telegram data the edge function `gifts` verifies at purchase time).
--  * Admin ("shop.manage") sees pending / delivered orders and confirms delivery once; who and when is stored and
--    audited; the edge function then tells the buyer through the DAMEO bot.
-- Additive: two new tables + functions.

create table if not exists public.gift_catalog (
  id        text primary key,
  title_uz  text not null,
  title_en  text not null,
  emoji     text not null,
  image     text,                      -- path of the picture in the web app (docs/gifts/…)
  price     int not null check (price > 0),
  active    boolean not null default true,
  sort      int not null default 0
);
insert into public.gift_catalog (id, title_uz, title_en, emoji, image, price, sort) values
  ('bear',     'Ayiqcha',        'Bear',     '🧸', 'gifts/bear.png',     2000, 1),
  ('heart',    'Yurak',          'Heart',    '💝', 'gifts/heart.png',    2000, 2),
  ('rose',     'Atirgul',        'Rose',     '🌹', 'gifts/rose.png',     3500, 3),
  ('gift_box', 'Sovg''a qutisi', 'Gift Box', '🎁', 'gifts/gift_box.png', 3500, 4)
on conflict (id) do nothing;

create table if not exists public.gift_orders (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete restrict,
  gift_id       text not null references public.gift_catalog(id),
  price         int not null,
  code          text not null check (code ~ '^[0-9]{4}$'),
  tg_id         bigint not null,
  tg_username   text,
  idem_key      text not null,
  status        text not null default 'pending' check (status in ('pending', 'delivered')),
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  delivered_by  uuid references public.profiles(id) on delete set null,
  notified_at   timestamptz,
  notify_error  text,
  unique (code),                       -- a code is never reused
  unique (user_id, idem_key)           -- the same purchase cannot be made twice
);
create index if not exists gift_orders_status_idx on public.gift_orders (status, created_at desc);
create index if not exists gift_orders_user_idx on public.gift_orders (user_id, created_at desc);

alter table public.gift_catalog enable row level security;
alter table public.gift_orders enable row level security;
create policy gift_catalog_read on public.gift_catalog for select to anon, authenticated using (active);
revoke all on public.gift_catalog, public.gift_orders from anon, authenticated;
grant select on public.gift_catalog to anon, authenticated;
grant select, insert, update on public.gift_catalog, public.gift_orders to service_role;
grant usage, select on sequence public.gift_orders_id_seq to service_role;

/* ------------------------------------------------------------ purchase (edge function only) */
create or replace function public.gift_order_create(p_user uuid, p_gift text, p_idem text, p_username text) returns json
language plpgsql security definer set search_path = public as $$
declare me public.profiles; g public.gift_catalog; o public.gift_orders; c text; tries int := 0; bal bigint;
        uname text := nullif(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''), '');
begin
  if p_idem is null or length(p_idem) < 8 or length(p_idem) > 80 then return json_build_object('ok', false, 'reason', 'bad-key'); end if;
  select * into me from public.profiles where id = p_user for update;                     -- one purchase at a time
  if not found then return json_build_object('ok', false, 'reason', 'no-account'); end if;
  -- the same key again (double tap / network retry): the existing order, nothing charged twice
  select * into o from public.gift_orders where user_id = p_user and idem_key = p_idem;
  if found then
    select * into g from public.gift_catalog where id = o.gift_id;
    return json_build_object('ok', true, 'repeat', true, 'order_id', o.id, 'code', o.code, 'gift', o.gift_id, 'price', o.price,
                             'username', o.tg_username, 'balance', (select balance from public.user_wallets where user_id = p_user));
  end if;
  if public._is_banned(p_user) then return json_build_object('ok', false, 'reason', 'restricted'); end if;
  if me.tg_id is null then return json_build_object('ok', false, 'reason', 'no-telegram'); end if;
  select * into g from public.gift_catalog where id = p_gift and active;
  if not found then return json_build_object('ok', false, 'reason', 'unknown-gift'); end if;
  if coalesce((select balance from public.user_wallets where user_id = p_user), 0) < g.price then
    return json_build_object('ok', false, 'reason', 'insufficient', 'price', g.price);
  end if;
  -- p_username: verified Telegram data ('' = verified: no username); null = unknown → last name the bot saw
  if p_username is null then select b.username into uname from public.bot_subscribers b where b.tg_id = me.tg_id; end if;
  if uname is not null and uname !~ '^[A-Za-z0-9_]{4,32}$' then uname := null; end if;
  -- a fresh random 4-digit code that no order has ever used
  perform pg_advisory_xact_lock(hashtext('gift_order_code'));
  loop
    c := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    exit when not exists (select 1 from public.gift_orders where code = c);
    tries := tries + 1;
    if tries > 200 then
      select s::text into c from generate_series(1000, 9999) s where not exists (select 1 from public.gift_orders where code = s::text) order by random() limit 1;
      if c is null then raise exception 'codes exhausted'; end if;
      exit;
    end if;
  end loop;
  insert into public.gift_orders (user_id, gift_id, price, code, tg_id, tg_username, idem_key)
  values (p_user, g.id, g.price, c, me.tg_id, uname, p_idem) returning * into o;
  bal := public._wallet_apply(p_user, -g.price, 'purchase', 'gift', o.id::text, 'gift:' || o.id, g.id, null);
  return json_build_object('ok', true, 'repeat', false, 'order_id', o.id, 'code', o.code, 'gift', g.id, 'price', g.price,
                           'username', o.tg_username, 'balance', bal);
end $$;

/* ------------------------------------------------------------ player */
create or replace function public.gift_my_orders() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', o.id, 'gift', o.gift_id, 'price', o.price, 'code', o.code, 'status', o.status,
                                             'username', o.tg_username, 'created_at', o.created_at, 'delivered_at', o.delivered_at)
                           order by o.id desc), '[]'::json)
  from public.gift_orders o where o.user_id = auth.uid();
$$;

/* ------------------------------------------------------------ admin ("Sovg'a buyurtmalari") */
create or replace function public.admin_gift_orders(p_status text default 'pending', p_limit int default 100) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._admin_require('shop.manage');
  -- pending: oldest first (the delivery queue); delivered / all: newest first
  return coalesce((select json_agg(x order by case when p_status = 'pending' then (x->>'id')::bigint else -(x->>'id')::bigint end) from (
    select json_build_object('id', o.id, 'code', o.code, 'gift', o.gift_id, 'gift_title', g.title_uz, 'emoji', g.emoji, 'image', g.image,
             'price', o.price, 'tg_id', o.tg_id::text, 'tg_username', o.tg_username, 'user_id', o.user_id, 'player', p.username,
             'avatar', p.avatar, 'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at,
             'delivered_by', a.username, 'notified_at', o.notified_at, 'notify_error', o.notify_error)::jsonb as x
      from public.gift_orders o
      join public.gift_catalog g on g.id = o.gift_id
      join public.profiles p on p.id = o.user_id
      left join public.profiles a on a.id = o.delivered_by
     where (p_status is null or p_status = 'all' or o.status = p_status)
     order by case when p_status = 'pending' then o.id else -o.id end limit greatest(1, least(p_limit, 500))) s), '[]'::json);
end $$;

create or replace function public.admin_gift_counts() returns json
language sql stable security definer set search_path = public as $$
  select case when public.admin_has_perm(auth.uid(), 'shop.manage') then
    json_build_object('pending', count(*) filter (where status = 'pending'), 'delivered', count(*) filter (where status = 'delivered'))
  end from public.gift_orders;
$$;

-- "Tasdiqlash": pending → delivered exactly once (a second press changes nothing)
create or replace function public.admin_gift_confirm(p_order bigint) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); o public.gift_orders;
begin
  update public.gift_orders set status = 'delivered', delivered_at = now(), delivered_by = uid
   where id = p_order and status = 'pending' returning * into o;
  if not found then
    select * into o from public.gift_orders where id = p_order;
    if not found then raise exception 'not found'; end if;
    return json_build_object('ok', false, 'reason', 'already', 'delivered_at', o.delivered_at);
  end if;
  perform public._audit(uid, 'gift.delivered', 'gift_order', o.id::text, 'delivered', jsonb_build_object('code', o.code, 'gift', o.gift_id, 'tg_id', o.tg_id));
  return json_build_object('ok', true, 'order_id', o.id, 'tg_id', o.tg_id::text, 'gift', o.gift_id, 'code', o.code, 'delivered_at', o.delivered_at);
end $$;

-- the bot message result (edge function)
create or replace function public.gift_order_notified(p_order bigint, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.gift_orders set notified_at = case when p_ok then now() else notified_at end,
                                notify_error = case when p_ok then null else left(p_error, 200) end
   where id = p_order;
$$;

revoke all on function public.gift_order_create(uuid, text, text, text), public.gift_my_orders(), public.admin_gift_orders(text, int),
  public.admin_gift_counts(), public.admin_gift_confirm(bigint), public.gift_order_notified(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.gift_my_orders(), public.admin_gift_orders(text, int), public.admin_gift_counts(), public.admin_gift_confirm(bigint) to authenticated;
grant execute on function public.gift_order_create(uuid, text, text, text), public.gift_order_notified(bigint, boolean, text) to service_role;
