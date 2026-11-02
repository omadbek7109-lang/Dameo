-- DAMEO 0011: DAMEO Coins (ledger wallet), Telegram Stars top-ups, Shop & Inventory, Admin roles + audit,
-- account restrictions, reports, notifications.
--
-- Security model (unchanged principle): the browser never writes balances, orders, inventory or roles.
--  * Every coin movement goes through _wallet_apply(): one locked wallet row, one ledger row, balance >= 0,
--    optional idempotency key (unique per user) → retries and double clicks are never charged twice.
--  * Top-ups are credited ONLY by payment_complete(), which is callable by the service role alone and is invoked by the
--    telegram-bot Edge Function when Telegram reports `successful_payment` (unique telegram_payment_charge_id).
--  * Admin rights are checked on the server for every call (_admin_require). The super admin is bound to the Telegram
--    account id 7550418397 (not to a username) and cannot be removed; other roles are granted only by the super admin.
--  * Every admin action is written to admin_audit_logs together with the mandatory reason.
-- Additive only: new tables/columns/functions; Elo, matches and game logic are untouched.

/* ================================================================= admin roles & audit */
create table if not exists public.admin_roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       text check (role in ('admin', 'moderator', 'support')),            -- null = revoked (rows are kept for history)
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_time_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_admin_idx on public.admin_audit_logs (admin_id, created_at desc);
alter table public.admin_roles enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_roles, public.admin_audit_logs from anon, authenticated;
grant select, insert, update on public.admin_roles, public.admin_audit_logs to service_role;

-- The owner's Telegram account is always super admin (survives username changes, cannot be revoked by anyone).
create or replace function public.admin_role_of(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.profiles where id = p_uid and tg_id = 7550418397) then 'super_admin'
              else (select role from public.admin_roles where user_id = p_uid) end;
$$;

create or replace function public._admin_perms(p_role text) returns text[]
language sql immutable set search_path = public as $$
  select case p_role
    when 'super_admin' then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view','roles.manage']
    when 'admin'       then array['dashboard','users.view','users.ban','balance.view','balance.adjust','payments.view','payments.refund',
                                  'shop.manage','tournaments.manage','reports.view','reports.manage','chat.moderate','audit.view']
    when 'moderator'   then array['dashboard','users.view','users.ban','reports.view','reports.manage','chat.moderate']
    when 'support'     then array['dashboard','users.view','balance.view','payments.view','reports.view']
    else array[]::text[] end;
$$;

create or replace function public.admin_has_perm(p_uid uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_perm = any(public._admin_perms(public.admin_role_of(p_uid))), false);
$$;

-- Raises unless the caller holds the permission; returns the caller's id.
create or replace function public._admin_require(p_perm text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.admin_has_perm(uid, p_perm) then raise exception 'forbidden' using errcode = '42501'; end if;
  return uid;
end $$;

create or replace function public._audit(p_admin uuid, p_action text, p_target_type text, p_target_id text, p_reason text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, details)
  values (p_admin, p_action, p_target_type, p_target_id, p_reason, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public._need_reason(p_reason text) returns text
language plpgsql immutable set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'reason required'; end if;
  return left(trim(p_reason), 500);
end $$;

/* ================================================================= notifications */
create table if not exists public.user_notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
alter table public.user_notifications enable row level security;
create policy user_notifications_own on public.user_notifications for select to authenticated using (user_id = auth.uid());
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant select, insert, update on public.user_notifications to service_role;
alter publication supabase_realtime add table public.user_notifications;

create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.user_notifications (user_id, kind, title, body, data) values (p_user, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb));
$$;

create or replace function public.notifications_mine(p_limit int default 30) returns setof public.user_notifications
language sql stable security definer set search_path = public as $$
  select * from public.user_notifications where user_id = auth.uid() order by created_at desc limit greatest(1, least(p_limit, 100));
$$;
create or replace function public.notifications_mark_read() returns void
language sql security definer set search_path = public as $$
  update public.user_notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

/* ================================================================= restrictions (ban / mute) */
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists muted_until timestamptz;
-- (clients keep column-level UPDATE only on username/avatar/country — these columns are server-only)

create or replace function public._is_banned(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned_until > now() from public.profiles where id = p_uid), false);
$$;

-- A restricted account cannot start or join games, queue for matchmaking or join tournaments.
-- Enforced with triggers so every existing entry point (quick_match, challenges, rooms, bot games) is covered unchanged.
create or replace function public._guard_banned_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (public._is_banned(new.white_id) or (new.black_id is not null and public._is_banned(new.black_id))) then
    raise exception 'account restricted' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.black_id is distinct from old.black_id and new.black_id is not null and public._is_banned(new.black_id) then
    raise exception 'account restricted' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger matches_guard_banned before insert or update of black_id on public.matches
  for each row execute function public._guard_banned_match();

create or replace function public._guard_banned_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_seen > now() - interval '1 minute' and public._is_banned(new.user_id) then
    raise exception 'account restricted' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger queue_guard_banned before insert or update on public.matchmaking_queue
  for each row execute function public._guard_banned_queue();
create or replace function public._guard_banned_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._is_banned(new.user_id) then raise exception 'account restricted' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger weekly_guard_banned before insert on public.weekly_entries
  for each row execute function public._guard_banned_entry();

/* ================================================================= wallet (DAMEO Coins) */
create table if not exists public.user_wallets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  amount        bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind          text not null check (kind in ('topup','purchase','refund','admin_credit','admin_debit','gift_sent','gift_received','reward')),
  ref_type      text,
  ref_id        text,
  idem_key      text,
  note          text,
  actor_id      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists wallet_tx_idem_idx on public.wallet_transactions (user_id, idem_key) where idem_key is not null;
create index if not exists wallet_tx_user_idx on public.wallet_transactions (user_id, id desc);
alter table public.user_wallets enable row level security;
alter table public.wallet_transactions enable row level security;
create policy user_wallets_own on public.user_wallets for select to authenticated using (user_id = auth.uid());
create policy wallet_tx_own on public.wallet_transactions for select to authenticated using (user_id = auth.uid());
revoke all on public.user_wallets, public.wallet_transactions from anon, authenticated;
grant select on public.user_wallets, public.wallet_transactions to authenticated;
grant select, insert, update on public.user_wallets, public.wallet_transactions to service_role;
alter publication supabase_realtime add table public.user_wallets;

-- every profile gets a wallet (new sign-ups via trigger, existing players backfilled)
create or replace function public._wallet_create() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_wallets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger profiles_wallet after insert on public.profiles for each row execute function public._wallet_create();
insert into public.user_wallets (user_id) select id from public.profiles on conflict do nothing;

-- THE only way coins move. Atomic (row lock), never negative, idempotent per (user, key). Returns the new balance.
create or replace function public._wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref_type text, p_ref_id text,
                                                p_idem text, p_note text, p_actor uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare b bigint;
begin
  if p_amount = 0 then raise exception 'zero amount'; end if;
  insert into public.user_wallets (user_id) values (p_user) on conflict do nothing;
  select balance into b from public.user_wallets where user_id = p_user for update;
  if p_idem is not null and exists (select 1 from public.wallet_transactions where user_id = p_user and idem_key = p_idem) then
    return b;                                                    -- replay: already applied
  end if;
  if b + p_amount < 0 then raise exception 'insufficient funds' using errcode = 'P0001'; end if;
  update public.user_wallets set balance = b + p_amount, updated_at = now() where user_id = p_user;
  insert into public.wallet_transactions (user_id, amount, balance_after, kind, ref_type, ref_id, idem_key, note, actor_id)
  values (p_user, p_amount, b + p_amount, p_kind, p_ref_type, p_ref_id, p_idem, p_note, p_actor);
  return b + p_amount;
end $$;

create or replace function public.wallet_me() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('balance', coalesce(w.balance, 0), 'updated_at', w.updated_at)
  from (select auth.uid() as uid) u left join public.user_wallets w on w.user_id = u.uid;
$$;

-- ledger, newest first; keyset pagination with p_before (id)
create or replace function public.wallet_history(p_limit int default 30, p_before bigint default null)
returns table (id bigint, amount bigint, balance_after bigint, kind text, ref_type text, ref_id text, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.amount, t.balance_after, t.kind, t.ref_type, t.ref_id, t.note, t.created_at
  from public.wallet_transactions t
  where t.user_id = auth.uid() and (p_before is null or t.id < p_before)
  order by t.id desc limit greatest(1, least(p_limit, 100));
$$;

/* ================================================================= Telegram Stars top-ups */
create table if not exists public.coin_packages (
  id          text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  coins       int not null check (coins > 0),
  bonus_coins int not null default 0 check (bonus_coins >= 0),
  stars       int not null check (stars between 1 and 100000),
  active      boolean not null default true,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
insert into public.coin_packages (id, coins, stars, sort) values
  ('coins_5k', 5000, 25, 1), ('coins_10k', 10000, 50, 2), ('coins_25k', 25000, 120, 3),
  ('coins_50k', 50000, 235, 4), ('coins_100k', 100000, 460, 5)
on conflict (id) do nothing;

create table if not exists public.payment_orders (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.profiles(id) on delete cascade,
  package_id                 text references public.coin_packages(id) on delete set null,
  coins                      int not null check (coins > 0),
  stars                      int not null check (stars > 0),
  currency                   text not null default 'XTR',
  provider                   text not null default 'telegram_stars',
  status                     text not null default 'pending' check (status in ('pending','paid','rejected','refunded')),
  status_reason              text,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  tg_user_id                 bigint,
  raw                        jsonb,
  created_at                 timestamptz not null default now(),
  paid_at                    timestamptz,
  refunded_at                timestamptz,
  handled_by                 uuid references public.profiles(id) on delete set null
);
create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);
create index if not exists payment_orders_status_idx on public.payment_orders (status, created_at desc);
alter table public.coin_packages enable row level security;
alter table public.payment_orders enable row level security;
create policy coin_packages_read on public.coin_packages for select to anon, authenticated using (active);
create policy payment_orders_own on public.payment_orders for select to authenticated using (user_id = auth.uid());
revoke all on public.coin_packages, public.payment_orders from anon, authenticated;
grant select on public.coin_packages to anon, authenticated;
grant select on public.payment_orders to authenticated;
grant select, insert, update on public.coin_packages, public.payment_orders to service_role;

-- (service role) a new order for a package; called by the `payments` Edge Function before it asks Telegram for an invoice
create or replace function public.payment_create(p_user uuid, p_package text) returns json
language plpgsql security definer set search_path = public as $$
declare p public.coin_packages; o public.payment_orders; n int;
begin
  if public._is_banned(p_user) then raise exception 'account restricted'; end if;
  select * into p from public.coin_packages where id = p_package and active;
  if not found then raise exception 'package not found'; end if;
  update public.payment_orders set status = 'rejected', status_reason = 'expired'
   where user_id = p_user and status = 'pending' and created_at < now() - interval '1 day';
  select count(*) into n from public.payment_orders where user_id = p_user and created_at > now() - interval '1 hour';
  if n >= 20 then raise exception 'too many orders'; end if;
  insert into public.payment_orders (user_id, package_id, coins, stars, tg_user_id)
  values (p_user, p.id, p.coins + p.bonus_coins, p.stars, (select tg_id from public.profiles where id = p_user))
  returning * into o;
  return json_build_object('order_id', o.id, 'coins', o.coins, 'stars', o.stars);
end $$;

-- (service role) Telegram pre_checkout_query: may this exact payment go through? null = yes, otherwise the reason.
create or replace function public.payment_precheck(p_order uuid, p_stars int, p_currency text, p_tg bigint) returns text
language plpgsql security definer set search_path = public as $$
declare o public.payment_orders;
begin
  select * into o from public.payment_orders where id = p_order;
  if not found then return 'order not found'; end if;
  if o.status <> 'pending' then return 'order is ' || o.status; end if;
  if o.created_at < now() - interval '1 day' then return 'order expired'; end if;
  if p_currency <> 'XTR' or p_stars <> o.stars then return 'amount mismatch'; end if;
  if o.tg_user_id is distinct from p_tg then return 'wrong account'; end if;
  if public._is_banned(o.user_id) then return 'account restricted'; end if;
  return null;
end $$;

-- (service role) Telegram successful_payment: credit the coins exactly once (unique Telegram charge id + ledger key).
create or replace function public.payment_complete(p_order uuid, p_charge text, p_provider_charge text, p_stars int, p_tg bigint, p_raw jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o public.payment_orders; bal bigint;
begin
  if p_charge is null or length(p_charge) < 4 then raise exception 'charge id required'; end if;
  if exists (select 1 from public.payment_orders where telegram_payment_charge_id = p_charge) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;
  select * into o from public.payment_orders where id = p_order for update;
  if not found then
    perform public._audit(null, 'payment.orphan', 'payment', p_charge, 'paid charge without order', jsonb_build_object('order', p_order, 'stars', p_stars, 'tg', p_tg));
    return json_build_object('ok', false, 'error', 'order not found');
  end if;
  if o.status = 'paid' or o.status = 'refunded' then return json_build_object('ok', true, 'duplicate', true); end if;
  if p_stars <> o.stars or o.tg_user_id is distinct from p_tg then
    update public.payment_orders set status_reason = 'needs review: paid amount/account mismatch', raw = p_raw,
           telegram_payment_charge_id = p_charge, provider_payment_charge_id = p_provider_charge where id = o.id;
    perform public._audit(null, 'payment.mismatch', 'payment', o.id::text, 'needs review', jsonb_build_object('stars', p_stars, 'tg', p_tg));
    return json_build_object('ok', false, 'error', 'needs review');
  end if;
  update public.payment_orders set status = 'paid', status_reason = null, paid_at = now(), telegram_payment_charge_id = p_charge,
         provider_payment_charge_id = p_provider_charge, raw = p_raw where id = o.id;
  bal := public._wallet_apply(o.user_id, o.coins, 'topup', 'payment', o.id::text, 'pay:' || p_charge, o.stars || ' Telegram Stars', null);
  perform public._notify(o.user_id, 'wallet.topup', 'DAMEO Coins', '+' || o.coins || ' 🪙', jsonb_build_object('order', o.id, 'coins', o.coins, 'balance', bal));
  return json_build_object('ok', true, 'user_id', o.user_id, 'coins', o.coins, 'balance', bal);
end $$;

-- (service role) refund in two safe steps around the Telegram API call:
-- begin: takes the coins back first (fails if they are already spent) and marks the order refunded;
-- revert: if Telegram refuses the refund, gives the coins back and restores the order.
create or replace function public.payment_refund_begin(p_order uuid, p_admin uuid, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare o public.payment_orders; r text := public._need_reason(p_reason);
begin
  if not public.admin_has_perm(p_admin, 'payments.refund') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.payment_orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'paid' then raise exception 'order is %', o.status; end if;
  perform public._wallet_apply(o.user_id, -o.coins, 'refund', 'payment', o.id::text, 'refund:' || o.id, r, p_admin);
  update public.payment_orders set status = 'refunded', refunded_at = now(), handled_by = p_admin, status_reason = r where id = o.id;
  perform public._audit(p_admin, 'payment.refund', 'payment', o.id::text, r, jsonb_build_object('coins', o.coins, 'stars', o.stars, 'user', o.user_id));
  return json_build_object('tg_user_id', o.tg_user_id, 'charge_id', o.telegram_payment_charge_id, 'stars', o.stars, 'user_id', o.user_id);
end $$;
create or replace function public.payment_refund_revert(p_order uuid, p_admin uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.payment_orders;
begin
  select * into o from public.payment_orders where id = p_order for update;
  if not found or o.status <> 'refunded' then return; end if;
  perform public._wallet_apply(o.user_id, o.coins, 'refund', 'payment', o.id::text, 'refund-revert:' || o.id || ':' || extract(epoch from now())::bigint,
                               'Telegram refund failed', p_admin);
  update public.payment_orders set status = 'paid', refunded_at = null, status_reason = 'refund failed: ' || left(coalesce(p_error, ''), 200) where id = o.id;
  perform public._audit(p_admin, 'payment.refund_failed', 'payment', o.id::text, left(coalesce(p_error, ''), 200), '{}'::jsonb);
end $$;

create or replace function public.payments_mine(p_limit int default 20)
returns table (id uuid, coins int, stars int, status text, created_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, coins, stars, status, created_at, paid_at from public.payment_orders
  where user_id = auth.uid() and status <> 'pending' order by created_at desc limit greatest(1, least(p_limit, 50));
$$;

/* ================================================================= shop & inventory */
create table if not exists public.shop_categories (
  id      text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name_uz text not null,
  name_en text not null,
  sort    int not null default 0,
  visible boolean not null default true
);
create table if not exists public.shop_items (
  slug             text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  category_id      text not null references public.shop_categories(id) on update cascade,
  slot             text not null check (slot in ('piece', 'board', 'effect')),
  collection       text not null default 'classic',
  name_uz          text not null check (length(name_uz) between 2 and 60),
  name_en          text not null check (length(name_en) between 2 and 60),
  desc_uz          text not null default '',
  desc_en          text not null default '',
  rarity           text not null default 'common' check (rarity in ('common','rare','epic','legendary','mythic')),
  price            int not null default 0 check (price >= 0 and price <= 10000000),
  discount_percent int not null default 0 check (discount_percent between 0 and 90),
  is_free          boolean not null default false,
  is_default       boolean not null default false,
  active           boolean not null default true,     -- visible in the shop
  retired          boolean not null default false,    -- no longer sold (owners keep it)
  premium_only     boolean not null default false,
  style            jsonb not null default '{}'::jsonb,
  image_url        text,
  sort             int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists shop_items_cat_idx on public.shop_items (category_id, sort);
create table if not exists public.user_inventory (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  item_slug   text not null references public.shop_items(slug) on update cascade,
  source      text not null default 'purchase' check (source in ('purchase','gift','admin','reward','premium')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_slug)
);
create table if not exists public.shop_purchases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_slug  text not null references public.shop_items(slug) on update cascade,
  price_paid int not null,
  idem_key   text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idem_key)
);
create index if not exists shop_purchases_time_idx on public.shop_purchases (created_at desc);
alter table public.profiles add column if not exists equipped_piece text references public.shop_items(slug) on update cascade on delete set null;
alter table public.profiles add column if not exists equipped_board text references public.shop_items(slug) on update cascade on delete set null;
alter table public.profiles add column if not exists equipped_effect text references public.shop_items(slug) on update cascade on delete set null;

alter table public.shop_categories enable row level security;
alter table public.shop_items enable row level security;
alter table public.user_inventory enable row level security;
alter table public.shop_purchases enable row level security;
create policy shop_categories_read on public.shop_categories for select to anon, authenticated using (visible);
create policy shop_items_read on public.shop_items for select to anon, authenticated using (active);
create policy user_inventory_own on public.user_inventory for select to authenticated using (user_id = auth.uid());
create policy shop_purchases_own on public.shop_purchases for select to authenticated using (user_id = auth.uid());
revoke all on public.shop_categories, public.shop_items, public.user_inventory, public.shop_purchases from anon, authenticated;
grant select on public.shop_categories, public.shop_items to anon, authenticated;
grant select on public.user_inventory, public.shop_purchases to authenticated;
grant select, insert, update on public.shop_categories, public.shop_items, public.user_inventory, public.shop_purchases to service_role;

create or replace function public._final_price(i public.shop_items) returns int
language sql immutable set search_path = public as $$
  select case when i.is_free then 0 else (i.price * (100 - i.discount_percent) / 100) end;
$$;

-- Shop for the current user: categories + items (with owned / equipped flags) in one call. Public.
create or replace function public.shop_catalog() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name_uz', c.name_uz, 'name_en', c.name_en) order by c.sort), '[]'::json)
                     from public.shop_categories c where c.visible),
    'items', (select coalesce(json_agg(json_build_object(
                'slug', i.slug, 'category_id', i.category_id, 'slot', i.slot, 'collection', i.collection,
                'name_uz', i.name_uz, 'name_en', i.name_en, 'desc_uz', i.desc_uz, 'desc_en', i.desc_en, 'rarity', i.rarity,
                'price', i.price, 'final_price', public._final_price(i), 'discount_percent', i.discount_percent,
                'is_free', i.is_free, 'is_default', i.is_default, 'retired', i.retired, 'premium_only', i.premium_only,
                'style', i.style, 'image_url', i.image_url,
                'owned', i.is_free or i.is_default or exists (select 1 from public.user_inventory v where v.user_id = auth.uid() and v.item_slug = i.slug))
              order by i.sort, i.slug), '[]'::json)
              from public.shop_items i join public.shop_categories c on c.id = i.category_id where i.active and c.visible),
    'equipped', (select json_build_object('piece', p.equipped_piece, 'board', p.equipped_board, 'effect', p.equipped_effect)
                   from public.profiles p where p.id = auth.uid()));
$$;

-- Buy one item with coins. Serialized per user (wallet row lock), never charged twice (owned check + idempotency key).
create or replace function public.shop_buy(p_slug text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.shop_items; price int; bal bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 80 then raise exception 'bad request key'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  insert into public.user_wallets (user_id) values (uid) on conflict do nothing;
  perform 1 from public.user_wallets where user_id = uid for update;          -- one purchase at a time per player
  if exists (select 1 from public.shop_purchases where user_id = uid and idem_key = p_key) then
    return json_build_object('ok', true, 'duplicate', true, 'balance', (select balance from public.user_wallets where user_id = uid));
  end if;
  select * into i from public.shop_items where slug = p_slug;
  if not found or not i.active then raise exception 'item not found'; end if;
  if i.retired then raise exception 'item not for sale'; end if;
  if i.premium_only then raise exception 'premium only'; end if;
  if i.is_free or i.is_default or exists (select 1 from public.user_inventory where user_id = uid and item_slug = i.slug) then
    raise exception 'already owned';
  end if;
  price := public._final_price(i);
  bal := (select balance from public.user_wallets where user_id = uid);
  if price > 0 then
    bal := public._wallet_apply(uid, -price, 'purchase', 'shop_item', i.slug, 'buy:' || p_key, i.name_en, null);
  end if;
  insert into public.user_inventory (user_id, item_slug, source) values (uid, i.slug, 'purchase');
  insert into public.shop_purchases (user_id, item_slug, price_paid, idem_key) values (uid, i.slug, price, p_key);
  return json_build_object('ok', true, 'balance', bal, 'item', i.slug, 'price', price);
end $$;

-- Equip an owned (or free) item; null clears the slot (back to the default look). Synced to every device via the profile.
create or replace function public.equip_item(p_slot text, p_slug text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.shop_items;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_slot not in ('piece', 'board', 'effect') then raise exception 'bad slot'; end if;
  if p_slug is not null then
    select * into i from public.shop_items where slug = p_slug;
    if not found or i.slot <> p_slot then raise exception 'item not found'; end if;
    if not (i.is_free or i.is_default or exists (select 1 from public.user_inventory where user_id = uid and item_slug = i.slug)) then
      raise exception 'not owned';
    end if;
  end if;
  if p_slot = 'piece' then update public.profiles set equipped_piece = p_slug where id = uid;
  elsif p_slot = 'board' then update public.profiles set equipped_board = p_slug where id = uid;
  else update public.profiles set equipped_effect = p_slug where id = uid; end if;
  return json_build_object('ok', true, 'slot', p_slot, 'slug', p_slug);
end $$;

-- What a player has equipped (public: lets opponents/spectators see their pieces later).
create or replace function public.cosmetics_of(p_user uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'piece', (select json_build_object('slug', i.slug, 'style', i.style) from public.shop_items i where i.slug = p.equipped_piece),
    'board', (select json_build_object('slug', i.slug, 'style', i.style) from public.shop_items i where i.slug = p.equipped_board),
    'effect', (select json_build_object('slug', i.slug, 'style', i.style) from public.shop_items i where i.slug = p.equipped_effect))
  from public.profiles p where p.id = p_user;
$$;

/* ================================================================= reports (complaints & suggestions) */
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  match_id       uuid references public.matches(id) on delete set null,
  kind           text not null check (kind in ('player','chat','cheating','payment','bug','suggestion','other')),
  body           text not null check (length(body) between 3 and 1000),
  status         text not null default 'open' check (status in ('open','in_review','resolved','rejected')),
  admin_note     text,
  handled_by     uuid references public.profiles(id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;
create policy reports_own on public.reports for select to authenticated using (reporter_id = auth.uid());
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant select, insert, update on public.reports to service_role;

create or replace function public.report_create(p_kind text, p_body text, p_target uuid default null, p_match uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.reports;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many reports';
  end if;
  if p_target = uid then raise exception 'cannot report yourself'; end if;
  insert into public.reports (reporter_id, target_user_id, match_id, kind, body) values (uid, p_target, p_match, p_kind, trim(p_body))
  returning * into r;
  return json_build_object('id', r.id);
end $$;

/* ================================================================= weekly tournament: prizes in the DB + winner confirmation */
create table if not exists public.weekly_prizes (
  place      int primary key check (place between 1 and 5),
  title_uz   text not null,
  title_en   text not null,
  icon       text not null default '🏅',
  updated_at timestamptz not null default now()
);
insert into public.weekly_prizes (place, title_uz, title_en, icon) values
  (1, 'Telegram Premium (1 oy)', 'Telegram Premium (1 month)', '👑'),
  (2, '50 Telegram Stars', '50 Telegram Stars', '⭐'),
  (3, 'Ayiqcha Gift (15 ⭐)', 'Teddy bear gift (15 ⭐)', '🧸'),
  (4, 'Ayiqcha Gift (15 ⭐)', 'Teddy bear gift (15 ⭐)', '🧸'),
  (5, 'Ayiqcha Gift (15 ⭐)', 'Teddy bear gift (15 ⭐)', '🧸')
on conflict (place) do nothing;
alter table public.weekly_prizes enable row level security;
create policy weekly_prizes_read on public.weekly_prizes for select to anon, authenticated using (true);
revoke all on public.weekly_prizes from anon, authenticated;
grant select on public.weekly_prizes to anon, authenticated;
grant select, insert, update on public.weekly_prizes to service_role;
alter table public.weekly_tournaments add column if not exists confirmed_at timestamptz;
alter table public.weekly_tournaments add column if not exists confirmed_by uuid references public.profiles(id) on delete set null;
alter table public.weekly_entries add column if not exists prize_status text check (prize_status in ('confirmed', 'delivered'));

/* ================================================================= admin API */
create or replace function public.admin_me() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r text;
begin
  if uid is null then return json_build_object('role', null, 'perms', '[]'::json); end if;
  r := public.admin_role_of(uid);
  if r is not null and not exists (select 1 from public.admin_audit_logs where admin_id = uid and action = 'panel.open' and created_at > now() - interval '10 minutes') then
    perform public._audit(uid, 'panel.open', null, null, null, '{}'::jsonb);
  end if;
  return json_build_object('role', r, 'perms', to_json(public._admin_perms(r)));
end $$;

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
    'payments_paid', (select count(*) from public.payment_orders where status = 'paid'),
    'stars_today', (select coalesce(sum(stars), 0) from public.payment_orders where status = 'paid' and paid_at >= today),
    'stars_total', (select coalesce(sum(stars), 0) from public.payment_orders where status = 'paid'),
    'coins_circulation', (select coalesce(sum(balance), 0) from public.user_wallets),
    'purchases_today', (select count(*) from public.shop_purchases where created_at >= today),
    'reports_open', (select count(*) from public.reports where status in ('open', 'in_review')),
    'banned', (select count(*) from public.profiles where banned_until > now()),
    'server_now', now());
end $$;

create or replace function public.admin_users(p_query text default '', p_limit int default 30, p_offset int default 0)
returns table (id uuid, username text, avatar text, tg_id bigint, rating int, created_at timestamptz, last_seen timestamptz,
               banned_until timestamptz, muted_until timestamptz, balance bigint, role text, total bigint)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.view'); q text := trim(coalesce(p_query, ''));
begin
  return query
    select p.id, p.username, p.avatar, p.tg_id, p.rating, p.created_at, p.last_seen, p.banned_until, p.muted_until,
           coalesce(w.balance, 0), public.admin_role_of(p.id), count(*) over ()
    from public.profiles p left join public.user_wallets w on w.user_id = p.id
    where q = '' or p.username ilike '%' || replace(replace(q, '%', ''), '_', '\_') || '%' or p.tg_id::text = q or p.id::text = q
    order by p.created_at desc
    limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end $$;

create or replace function public.admin_user_detail(p_user uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.view'); can_money boolean := public.admin_has_perm(auth.uid(), 'balance.view');
begin
  return json_build_object(
    'profile', (select json_build_object('id', p.id, 'username', p.username, 'avatar', p.avatar, 'tg_id', p.tg_id, 'rating', p.rating,
                  'wins', p.wins, 'losses', p.losses, 'draws', p.draws, 'created_at', p.created_at, 'last_seen', p.last_seen,
                  'banned_until', p.banned_until, 'ban_reason', p.ban_reason, 'muted_until', p.muted_until, 'role', public.admin_role_of(p.id))
                from public.profiles p where p.id = p_user),
    'balance', case when can_money then (select balance from public.user_wallets where user_id = p_user) end,
    'ledger', case when can_money then (select coalesce(json_agg(x order by x.id desc), '[]'::json) from
                (select t.id, t.amount, t.balance_after, t.kind, t.note, t.created_at from public.wallet_transactions t
                 where t.user_id = p_user order by t.id desc limit 25) x) end,
    'payments', case when can_money then (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from
                (select o.id, o.coins, o.stars, o.status, o.created_at, o.paid_at from public.payment_orders o
                 where o.user_id = p_user order by o.created_at desc limit 20) x) end,
    'inventory', (select count(*) from public.user_inventory where user_id = p_user),
    'games', (select count(*) from public.matches where (white_id = p_user or black_id = p_user) and status = 'finished'),
    'reports_against', (select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from
                (select r.id, r.kind, r.body, r.status, r.created_at from public.reports r where r.target_user_id = p_user
                 order by r.created_at desc limit 20) x),
    'audit', (select coalesce(json_agg(x order by x.id desc), '[]'::json) from
                (select a.id, a.action, a.reason, a.created_at, (select username from public.profiles where id = a.admin_id) as admin
                 from public.admin_audit_logs a where a.target_type = 'user' and a.target_id = p_user::text order by a.id desc limit 20) x));
end $$;

-- the super admin and the other staff can only be restricted by someone above them
create or replace function public._admin_can_touch(p_admin uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.admin_role_of(p_target) is null then true
              when public.admin_role_of(p_target) = 'super_admin' then false
              else public.admin_role_of(p_admin) = 'super_admin' end;
$$;

create or replace function public.admin_ban(p_user uuid, p_until timestamptz, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.ban'); r text := public._need_reason(p_reason);
begin
  if p_user = uid then raise exception 'cannot restrict yourself'; end if;
  if not public._admin_can_touch(uid, p_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_until is null or p_until <= now() then raise exception 'bad date'; end if;
  update public.profiles set banned_until = p_until, ban_reason = r where id = p_user;
  if not found then raise exception 'user not found'; end if;
  update public.matchmaking_queue set last_seen = '-infinity' where user_id = p_user;
  perform public._audit(uid, 'user.ban', 'user', p_user::text, r, jsonb_build_object('until', p_until));
  perform public._notify(p_user, 'account.restricted', 'DAMEO', r, jsonb_build_object('until', p_until));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_unban(p_user uuid, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('users.ban'); r text := public._need_reason(p_reason);
begin
  update public.profiles set banned_until = null, ban_reason = null where id = p_user;
  if not found then raise exception 'user not found'; end if;
  perform public._audit(uid, 'user.unban', 'user', p_user::text, r, '{}'::jsonb);
  perform public._notify(p_user, 'account.restored', 'DAMEO', r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_mute(p_user uuid, p_until timestamptz, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('chat.moderate'); r text := public._need_reason(p_reason);
begin
  if not public._admin_can_touch(uid, p_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.profiles set muted_until = p_until where id = p_user;
  if not found then raise exception 'user not found'; end if;
  perform public._audit(uid, case when p_until is null or p_until <= now() then 'user.unmute' else 'user.mute' end, 'user', p_user::text, r,
                        jsonb_build_object('until', p_until));
  return json_build_object('ok', true);
end $$;

-- Manual balance change (credit or debit) — reason is mandatory; idempotent with the client key.
create or replace function public.admin_wallet_adjust(p_user uuid, p_amount bigint, p_reason text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('balance.adjust'); r text := public._need_reason(p_reason); bal bigint;
begin
  if p_amount = 0 or abs(p_amount) > 10000000 then raise exception 'bad amount'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'bad request key'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  if exists (select 1 from public.wallet_transactions where user_id = p_user and idem_key = 'admin:' || p_key) then   -- replay
    return json_build_object('ok', true, 'duplicate', true, 'balance', (select balance from public.user_wallets where user_id = p_user));
  end if;
  bal := public._wallet_apply(p_user, p_amount, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
                              'admin', uid::text, 'admin:' || p_key, r, uid);
  perform public._audit(uid, 'wallet.adjust', 'user', p_user::text, r, jsonb_build_object('amount', p_amount, 'balance', bal));
  perform public._notify(p_user, 'wallet.admin', 'DAMEO Coins', (case when p_amount > 0 then '+' else '' end) || p_amount || ' 🪙 — ' || r,
                         jsonb_build_object('amount', p_amount, 'balance', bal));
  return json_build_object('ok', true, 'balance', bal);
end $$;

create or replace function public.admin_payments(p_status text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, user_id uuid, username text, coins int, stars int, status text, status_reason text,
               telegram_payment_charge_id text, created_at timestamptz, paid_at timestamptz, refunded_at timestamptz, total bigint)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('payments.view');
begin
  return query
    select o.id, o.user_id, p.username, o.coins, o.stars, o.status, o.status_reason, o.telegram_payment_charge_id,
           o.created_at, o.paid_at, o.refunded_at, count(*) over ()
    from public.payment_orders o left join public.profiles p on p.id = o.user_id
    where p_status is null or o.status = p_status
    order by o.created_at desc limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end $$;

-- cancel an unpaid order (Telegram will then refuse the payment at pre-checkout)
create or replace function public.admin_payment_reject(p_order uuid, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('payments.refund'); r text := public._need_reason(p_reason);
begin
  update public.payment_orders set status = 'rejected', status_reason = r, handled_by = uid where id = p_order and status = 'pending';
  if not found then raise exception 'only pending orders can be rejected'; end if;
  perform public._audit(uid, 'payment.reject', 'payment', p_order::text, r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_packages() returns setof public.coin_packages
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('payments.view');
begin
  return query select * from public.coin_packages order by sort, coins;
end $$;

create or replace function public.admin_package_save(p jsonb, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason);
begin
  insert into public.coin_packages (id, coins, bonus_coins, stars, active, sort, updated_at)
  values (p->>'id', (p->>'coins')::int, coalesce((p->>'bonus_coins')::int, 0), (p->>'stars')::int, coalesce((p->>'active')::boolean, true),
          coalesce((p->>'sort')::int, 0), now())
  on conflict (id) do update set coins = excluded.coins, bonus_coins = excluded.bonus_coins, stars = excluded.stars,
                                 active = excluded.active, sort = excluded.sort, updated_at = now();
  perform public._audit(uid, 'package.save', 'package', p->>'id', r, p);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_shop_items() returns setof public.shop_items
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return query select * from public.shop_items order by category_id, sort, slug;
end $$;

-- create or update one item (prices, discount, visibility, retire, free/premium, look). Validated by the table constraints.
create or replace function public.admin_shop_save(p jsonb, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason); before jsonb;
begin
  select to_jsonb(i) into before from public.shop_items i where slug = p->>'slug';
  insert into public.shop_items (slug, category_id, slot, collection, name_uz, name_en, desc_uz, desc_en, rarity, price, discount_percent,
                                 is_free, active, retired, premium_only, style, image_url, sort, updated_at)
  values (p->>'slug', p->>'category_id', p->>'slot', coalesce(p->>'collection', 'classic'), p->>'name_uz', p->>'name_en',
          coalesce(p->>'desc_uz', ''), coalesce(p->>'desc_en', ''), coalesce(p->>'rarity', 'common'), coalesce((p->>'price')::int, 0),
          coalesce((p->>'discount_percent')::int, 0), coalesce((p->>'is_free')::boolean, false), coalesce((p->>'active')::boolean, true),
          coalesce((p->>'retired')::boolean, false), coalesce((p->>'premium_only')::boolean, false), coalesce(p->'style', '{}'::jsonb),
          nullif(p->>'image_url', ''), coalesce((p->>'sort')::int, 0), now())
  on conflict (slug) do update set category_id = excluded.category_id, slot = excluded.slot, collection = excluded.collection,
    name_uz = excluded.name_uz, name_en = excluded.name_en, desc_uz = excluded.desc_uz, desc_en = excluded.desc_en,
    rarity = excluded.rarity, price = excluded.price, discount_percent = excluded.discount_percent, is_free = excluded.is_free,
    active = excluded.active, retired = excluded.retired, premium_only = excluded.premium_only, style = excluded.style,
    image_url = excluded.image_url, sort = excluded.sort, updated_at = now();
  perform public._audit(uid, case when before is null then 'shop.create' else 'shop.update' end, 'shop_item', p->>'slug', r,
                        jsonb_build_object('before', before, 'after', p));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_category_save(p jsonb, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason);
begin
  insert into public.shop_categories (id, name_uz, name_en, sort, visible)
  values (p->>'id', p->>'name_uz', p->>'name_en', coalesce((p->>'sort')::int, 0), coalesce((p->>'visible')::boolean, true))
  on conflict (id) do update set name_uz = excluded.name_uz, name_en = excluded.name_en, sort = excluded.sort, visible = excluded.visible;
  perform public._audit(uid, 'category.save', 'category', p->>'id', r, p);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_categories() returns setof public.shop_categories
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return query select * from public.shop_categories order by sort;
end $$;

create or replace function public.admin_reports(p_status text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, kind text, body text, status text, admin_note text, created_at timestamptz, reporter text, reporter_id uuid,
               target text, target_user_id uuid, match_id uuid, total bigint)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('reports.view');
begin
  return query
    select r.id, r.kind, r.body, r.status, r.admin_note, r.created_at, a.username, r.reporter_id, b.username, r.target_user_id, r.match_id,
           count(*) over ()
    from public.reports r left join public.profiles a on a.id = r.reporter_id left join public.profiles b on b.id = r.target_user_id
    where p_status is null or r.status = p_status
    order by r.created_at desc limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end $$;

create or replace function public.admin_report_update(p_id uuid, p_status text, p_note text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('reports.manage'); r text := public._need_reason(p_note);
begin
  update public.reports set status = p_status, admin_note = r, handled_by = uid, handled_at = now() where id = p_id;
  if not found then raise exception 'report not found'; end if;
  perform public._audit(uid, 'report.' || p_status, 'report', p_id::text, r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_roles_list()
returns table (user_id uuid, username text, tg_id bigint, role text, granted_at timestamptz, granted_by text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('dashboard');
begin
  return query
    select p.id, p.username, p.tg_id, 'super_admin'::text, p.created_at, null::text from public.profiles p where p.tg_id = 7550418397
    union all
    select a.user_id, p.username, p.tg_id, a.role, a.granted_at, g.username
    from public.admin_roles a join public.profiles p on p.id = a.user_id left join public.profiles g on g.id = a.granted_by;
end $$;

-- Only the super admin grants or removes staff roles (role null = remove).
create or replace function public.admin_role_set(p_user uuid, p_role text, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('roles.manage'); r text := public._need_reason(p_reason); old text;
begin
  if public.admin_role_of(p_user) = 'super_admin' then raise exception 'the super admin role cannot be changed'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  old := public.admin_role_of(p_user);
  if p_role is null then
    update public.admin_roles set role = null, granted_by = uid, granted_at = now() where user_id = p_user;
  else
    if p_role not in ('admin', 'moderator', 'support') then raise exception 'bad role'; end if;
    insert into public.admin_roles (user_id, role, granted_by) values (p_user, p_role, uid)
    on conflict (user_id) do update set role = excluded.role, granted_by = uid, granted_at = now();
  end if;
  perform public._audit(uid, 'role.set', 'user', p_user::text, r, jsonb_build_object('from', old, 'to', p_role));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_audit(p_limit int default 50, p_offset int default 0, p_action text default null)
returns table (id bigint, admin text, action text, target_type text, target_id text, reason text, details jsonb, created_at timestamptz, total bigint)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('audit.view');
begin
  return query
    select a.id, p.username, a.action, a.target_type, a.target_id, a.reason, a.details, a.created_at, count(*) over ()
    from public.admin_audit_logs a left join public.profiles p on p.id = a.admin_id
    where p_action is null or a.action like p_action || '%'
    order by a.id desc limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end $$;

-- weekly tournaments: list, prizes, confirm winners, mark prizes delivered
create or replace function public.admin_weekly_list(p_limit int default 10) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('tournaments.manage');
begin
  return (select coalesce(json_agg(x order by x.ends_at desc), '[]'::json) from (
    select t.id, t.name, t.starts_at, t.ends_at, t.status, t.finalized_at, t.confirmed_at,
           (select username from public.profiles where id = t.confirmed_by) as confirmed_by,
           (select count(*) from public.weekly_entries e where e.tournament_id = t.id) as participants,
           (select coalesce(json_agg(json_build_object('rank', e.final_rank, 'user_id', e.user_id, 'username', p.username, 'tg_id', p.tg_id,
                                                       'delta', e.final_delta, 'games', e.final_games, 'prize_status', e.prize_status)
                                     order by e.final_rank), '[]'::json)
              from public.weekly_entries e join public.profiles p on p.id = e.user_id
             where e.tournament_id = t.id and e.final_rank between 1 and 5) as winners
    from public.weekly_tournaments t order by t.ends_at desc limit greatest(1, least(p_limit, 52))) x);
end $$;

create or replace function public.admin_weekly_prizes_save(p jsonb, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('tournaments.manage'); r text := public._need_reason(p_reason); x jsonb;
begin
  for x in select * from jsonb_array_elements(p) loop
    insert into public.weekly_prizes (place, title_uz, title_en, icon, updated_at)
    values ((x->>'place')::int, x->>'title_uz', x->>'title_en', coalesce(nullif(x->>'icon', ''), '🏅'), now())
    on conflict (place) do update set title_uz = excluded.title_uz, title_en = excluded.title_en, icon = excluded.icon, updated_at = now();
  end loop;
  perform public._audit(uid, 'weekly.prizes', 'weekly', null, r, jsonb_build_object('prizes', p));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_weekly_confirm(p_tournament uuid, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('tournaments.manage'); r text := public._need_reason(p_reason); t public.weekly_tournaments;
begin
  select * into t from public.weekly_tournaments where id = p_tournament for update;
  if not found then raise exception 'tournament not found'; end if;
  if t.status <> 'finished' then raise exception 'tournament not finished'; end if;
  if t.confirmed_at is not null then raise exception 'already confirmed'; end if;
  update public.weekly_tournaments set confirmed_at = now(), confirmed_by = uid where id = t.id;
  update public.weekly_entries set prize_status = 'confirmed' where tournament_id = t.id and final_rank between 1 and 5;
  perform public._notify(e.user_id, 'weekly.prize', 'DAMEO Weekly', t.name || ' — ' || e.final_rank || '-o''rin 🏆',
                         jsonb_build_object('tournament', t.id, 'rank', e.final_rank))
     from public.weekly_entries e where e.tournament_id = t.id and e.final_rank between 1 and 5;
  perform public._audit(uid, 'weekly.confirm', 'weekly', t.id::text, r, '{}'::jsonb);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_weekly_delivered(p_tournament uuid, p_user uuid, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('tournaments.manage'); r text := public._need_reason(p_reason);
begin
  update public.weekly_entries set prize_status = 'delivered'
   where tournament_id = p_tournament and user_id = p_user and prize_status = 'confirmed';
  if not found then raise exception 'confirm the winners first'; end if;
  perform public._audit(uid, 'weekly.delivered', 'user', p_user::text, r, jsonb_build_object('tournament', p_tournament));
  return json_build_object('ok', true);
end $$;

/* ================================================================= shop images (admins upload, everyone reads) */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop', 'shop', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];
-- argument-less check for storage policies (only answers about the caller)
create or replace function public.i_can_manage_shop() returns boolean
language sql stable security definer set search_path = public as $$ select public.admin_has_perm(auth.uid(), 'shop.manage') $$;
revoke all on function public.i_can_manage_shop() from public, anon;
grant execute on function public.i_can_manage_shop() to authenticated;
create policy shop_images_read on storage.objects for select to anon, authenticated using (bucket_id = 'shop');
create policy shop_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shop' and public.i_can_manage_shop());
create policy shop_images_update on storage.objects for update to authenticated
  using (bucket_id = 'shop' and public.i_can_manage_shop())
  with check (bucket_id = 'shop' and public.i_can_manage_shop());

/* ================================================================= weekly overview: prizes come from the DB now */
create or replace function public.weekly_overview() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur public.weekly_tournaments; prev public.weekly_tournaments; me json; winners json; n int;
begin
  perform public.weekly_tick();
  select * into cur from public.weekly_tournaments where week_start = (public._weekly_bounds(now())).week_start;
  select count(*) into n from public.weekly_entries where tournament_id = cur.id;
  if uid is not null then
    select json_build_object('joined', true, 'start_rating', l.start_rating, 'delta', l.delta, 'wins', l.wins,
                             'losses', l.losses, 'draws', l.draws, 'games', l.games, 'rank', l.rank, 'joined_at', l.joined_at)
      into me from public._weekly_live(cur.id) l where l.user_id = uid;
  end if;
  select * into prev from public.weekly_tournaments where status = 'finished' order by ends_at desc limit 1;
  if found then
    select coalesce(json_agg(json_build_object('rank', e.final_rank, 'user_id', e.user_id, 'username', p.username,
                                               'avatar', p.avatar, 'delta', e.final_delta, 'rating', e.final_rating,
                                               'wins', e.final_wins, 'losses', e.final_losses, 'games', e.final_games,
                                               'prize_status', e.prize_status)
                             order by e.final_rank), '[]'::json)
      into winners
      from public.weekly_entries e join public.profiles p on p.id = e.user_id
     where e.tournament_id = prev.id and e.final_rank between 1 and 5;
  end if;
  return json_build_object(
    'current', json_build_object('id', cur.id, 'name', cur.name, 'week_start', cur.week_start, 'starts_at', cur.starts_at,
                                 'ends_at', cur.ends_at, 'status', cur.status, 'participants', n),
    'me', coalesce(me, json_build_object('joined', false)),
    'previous', case when prev.id is null then null else
                  json_build_object('id', prev.id, 'name', prev.name, 'starts_at', prev.starts_at, 'ends_at', prev.ends_at,
                                    'confirmed', prev.confirmed_at is not null, 'winners', winners) end,
    'prizes', (select coalesce(json_agg(json_build_object('place', place, 'title_uz', title_uz, 'title_en', title_en, 'icon', icon) order by place), '[]'::json)
                 from public.weekly_prizes),
    'next_starts_at', cur.ends_at,
    'server_now', clock_timestamp());
end $$;

/* ================================================================= grants */
revoke all on function
  public.admin_role_of(uuid), public._admin_perms(text), public.admin_has_perm(uuid, text), public._admin_require(text),
  public._audit(uuid, text, text, text, text, jsonb), public._need_reason(text), public._notify(uuid, text, text, text, jsonb),
  public.notifications_mine(int), public.notifications_mark_read(), public._is_banned(uuid),
  public._wallet_apply(uuid, bigint, text, text, text, text, text, uuid), public.wallet_me(), public.wallet_history(int, bigint),
  public.payment_create(uuid, text), public.payment_precheck(uuid, int, text, bigint),
  public.payment_complete(uuid, text, text, int, bigint, jsonb), public.payment_refund_begin(uuid, uuid, text),
  public.payment_refund_revert(uuid, uuid, text), public.payments_mine(int), public._final_price(public.shop_items),
  public.shop_catalog(), public.shop_buy(text, text), public.equip_item(text, text), public.cosmetics_of(uuid),
  public.report_create(text, text, uuid, uuid), public.admin_me(), public.admin_dashboard(), public.admin_users(text, int, int),
  public.admin_user_detail(uuid), public._admin_can_touch(uuid, uuid), public.admin_ban(uuid, timestamptz, text),
  public.admin_unban(uuid, text), public.admin_mute(uuid, timestamptz, text), public.admin_wallet_adjust(uuid, bigint, text, text),
  public.admin_payments(text, int, int), public.admin_payment_reject(uuid, text), public.admin_packages(),
  public.admin_package_save(jsonb, text), public.admin_shop_items(), public.admin_shop_save(jsonb, text),
  public.admin_category_save(jsonb, text), public.admin_categories(), public.admin_reports(text, int, int),
  public.admin_report_update(uuid, text, text), public.admin_roles_list(), public.admin_role_set(uuid, text, text),
  public.admin_audit(int, int, text), public.admin_weekly_list(int), public.admin_weekly_prizes_save(jsonb, text),
  public.admin_weekly_confirm(uuid, text), public.admin_weekly_delivered(uuid, uuid, text)
from public, anon, authenticated;

-- signed-in players
grant execute on function public.notifications_mine(int), public.notifications_mark_read(), public.wallet_me(),
  public.wallet_history(int, bigint), public.payments_mine(int), public.shop_buy(text, text), public.equip_item(text, text),
  public.report_create(text, text, uuid, uuid), public.admin_me() to authenticated;
-- public reads
grant execute on function public.shop_catalog(), public.cosmetics_of(uuid) to anon, authenticated;
-- admin API (each function checks the caller's permission itself)
grant execute on function public.admin_dashboard(), public.admin_users(text, int, int), public.admin_user_detail(uuid),
  public.admin_ban(uuid, timestamptz, text), public.admin_unban(uuid, text), public.admin_mute(uuid, timestamptz, text),
  public.admin_wallet_adjust(uuid, bigint, text, text), public.admin_payments(text, int, int), public.admin_payment_reject(uuid, text),
  public.admin_packages(), public.admin_package_save(jsonb, text), public.admin_shop_items(), public.admin_shop_save(jsonb, text),
  public.admin_category_save(jsonb, text), public.admin_categories(), public.admin_reports(text, int, int),
  public.admin_report_update(uuid, text, text), public.admin_roles_list(), public.admin_role_set(uuid, text, text),
  public.admin_audit(int, int, text), public.admin_weekly_list(int), public.admin_weekly_prizes_save(jsonb, text),
  public.admin_weekly_confirm(uuid, text), public.admin_weekly_delivered(uuid, uuid, text) to authenticated;
-- server side (Edge Functions): payments + permission checks
grant execute on function public.payment_create(uuid, text), public.payment_precheck(uuid, int, text, bigint),
  public.payment_complete(uuid, text, text, int, bigint, jsonb), public.payment_refund_begin(uuid, uuid, text),
  public.payment_refund_revert(uuid, uuid, text), public.admin_has_perm(uuid, text), public.admin_role_of(uuid) to service_role;
