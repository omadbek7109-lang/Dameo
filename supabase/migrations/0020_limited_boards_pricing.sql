-- DAMEO 0020 (v3.2): Limited Board Collection + Coin/Stars pricing.
--
-- Limited boards
--  * The 12 old boards leave the shop (active = false, retired = true). Nothing is deleted: owners keep their inventory
--    rows and whatever they have equipped. A backup of every touched row is kept in _backup_v32_* tables first.
--  * 8 new boards (shop_items, collection 'limited') with the artwork in /boards/<slug>.webp.
--  * board_catalog (presentation), board_inventory (supply + sold counter), user_board_collections (owner + serial),
--    board_purchase_history (append-only purchase log).
--  * board_buy(): one transaction — player's wallet row locked, then the board's stock row locked (always in this order,
--    so concurrent buyers queue instead of deadlocking); serial = sold + 1; unique (board, serial) and (user, board).
--    The supply can never be exceeded, a sold-out board never comes back, serials never change.
--  * Supply of the first four boards is NULL until an admin sets it (once, never below the copies already sold).
--
-- Pricing
--  * pricing_settings: stars per 1 000 coins (25) and so'm per coin (10, display only).
--  * coin_packages.stars is computed from the rate (rounded UP to whole Stars: 500 coins = 12.5 → 13) unless an admin
--    pinned a manual price (stars_manual). Changing the rate re-prices every automatic package; manual ones are kept.
--  * price_history: every price change (package Stars/coins, board price, rate) with old value, new value, admin, reason.
--  * Telegram invoices keep using payment_create(): the server reads the package price from the DB, never from the client.
-- Additive: no table or row is dropped; game rules, matchmaking and Elo are untouched.

/* ================================================================= backup (before anything changes) */
create table if not exists public._backup_v32_board_items as select now() as backed_up_at, i.* from public.shop_items i where i.slot = 'board';
create table if not exists public._backup_v32_board_inventory as
  select now() as backed_up_at, v.* from public.user_inventory v join public.shop_items i on i.slug = v.item_slug where i.slot = 'board';
create table if not exists public._backup_v32_equipped_boards as
  select now() as backed_up_at, p.id as user_id, p.equipped_board from public.profiles p where p.equipped_board is not null;
create table if not exists public._backup_v32_coin_packages as select now() as backed_up_at, c.* from public.coin_packages c;
alter table public._backup_v32_board_items enable row level security;
alter table public._backup_v32_board_inventory enable row level security;
alter table public._backup_v32_equipped_boards enable row level security;
alter table public._backup_v32_coin_packages enable row level security;
revoke all on public._backup_v32_board_items, public._backup_v32_board_inventory, public._backup_v32_equipped_boards,
              public._backup_v32_coin_packages from anon, authenticated;

/* ================================================================= old boards leave the shop */
update public.shop_items set active = false, retired = true, updated_at = now()
 where slot = 'board' and collection <> 'limited';

/* ================================================================= the 8 Limited boards */
insert into public.shop_items (slug, category_id, slot, collection, name_uz, name_en, desc_uz, desc_en, rarity, price, is_free, is_default,
                               active, retired, style, image_url, sort)
values
  ('midnight-blue', 'boards', 'board', 'limited', 'Midnight Blue', 'Midnight Blue', 'Tungi ko''k marmar, oltin tomirlar.', 'Night-blue marble with gold veins.', 'common', 0, false, false, true, false,
   '{"light":"#3d5f96","dark":"#1b2a48","edge":"#2c3e66","edge2":"#d4a53c","frame":"gold","hl":"#e8bb4d","coord":"#c9d6f2","lt":"midnight-blue-l","dt":"midnight-blue-d"}', 'boards/midnight-blue.webp', 1),
  ('graphite', 'boards', 'board', 'limited', 'Graphite', 'Graphite', 'Silliqlangan grafit va ko''k nur.', 'Brushed graphite with a blue glow.', 'common', 500, false, false, true, false,
   '{"light":"#5a6170","dark":"#262a33","edge":"#3a4252","edge2":"#4ea3ff","frame":"metal","hl":"#4ea3ff","coord":"#c7cfdc","lt":"graphite-l","dt":"graphite-d"}', 'boards/graphite.webp', 2),
  ('royal-wood', 'boards', 'board', 'limited', 'Royal Wood', 'Royal Wood', 'Qimmatbaho yog''och va oltin naqsh.', 'Fine wood with gilded carvings.', 'rare', 1200, false, false, true, false,
   '{"light":"#d9a35c","dark":"#6b3b1c","edge":"#5b3a1e","edge2":"#c99a4b","frame":"wood","hl":"#f6c64f","coord":"#fff3dc","lt":"royal-wood-l","dt":"royal-wood-d"}', 'boards/royal-wood.webp', 3),
  ('emerald-board', 'boards', 'board', 'limited', 'Emerald', 'Emerald', 'Zumrad marmar, oltin ramka.', 'Emerald marble in a gold frame.', 'rare', 1800, false, false, true, false,
   '{"light":"#3f8a52","dark":"#123d22","edge":"#14402a","edge2":"#d4a53c","frame":"gold","hl":"#ffd54f","coord":"#e3f5e8","lt":"emerald-board-l","dt":"emerald-board-d"}', 'boards/emerald-board.webp', 4),
  ('cyber-purple', 'boards', 'board', 'limited', 'Cyber Purple', 'Cyber Purple', 'Binafsha neon chaqmoqlar.', 'Purple neon lightning.', 'epic', 2200, false, false, true, false,
   '{"light":"#5a4a7a","dark":"#1d1830","edge":"#7c3aed","edge2":"#a855f7","frame":"neon","hl":"#c084fc","coord":"#e9ddff","lt":"cyber-purple-l","dt":"cyber-purple-d"}', 'boards/cyber-purple.webp', 5),
  ('royal-marble', 'boards', 'board', 'limited', 'Royal Marble', 'Royal Marble', 'Oq va qora marmar, oltin tomirlar.', 'White and black marble, gold veins.', 'legendary', 3000, false, false, true, false,
   '{"light":"#efeeea","dark":"#1c1c1e","edge":"#b8862b","edge2":"#f2c75c","frame":"gold","hl":"#f2c75c","coord":"#8a6a1f","lt":"royal-marble-l","dt":"royal-marble-d"}', 'boards/royal-marble.webp', 6),
  ('obsidian-gold', 'boards', 'board', 'limited', 'Obsidian Gold', 'Obsidian Gold', 'Qora obsidian va eritilgan oltin.', 'Black obsidian and molten gold.', 'legendary', 4000, false, false, true, false,
   '{"light":"#3a3530","dark":"#0c0b0a","edge":"#2a2418","edge2":"#f0b429","frame":"gold","glow":"rgba(240,180,41,.35)","hl":"#ffcc4d","coord":"#f3d27a","lt":"obsidian-gold-l","dt":"obsidian-gold-d"}', 'boards/obsidian-gold.webp', 7),
  ('celestial-crown', 'boards', 'board', 'limited', 'Celestial Crown', 'Celestial Crown', 'Samoviy ko''k marmar va kumush toj.', 'Celestial blue marble, silver crown.', 'mythic', 5000, false, false, true, false,
   '{"light":"#eef1f8","dark":"#13307a","edge":"#c7cee0","edge2":"#3b6cff","frame":"metal","glow":"rgba(80,120,255,.45)","hl":"#7aa2ff","coord":"#1d3d8f","lt":"celestial-crown-l","dt":"celestial-crown-d"}', 'boards/celestial-crown.webp', 8)
on conflict (slug) do nothing;

/* ================================================================= limited collection tables */
create table if not exists public.board_catalog (
  slug       text primary key references public.shop_items(slug) on update cascade,
  tier       int not null check (tier between 1 and 8),             -- 8 = rarest; drives "most rare first"
  icon       text not null default '♟',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.board_inventory (
  slug        text primary key references public.board_catalog(slug) on update cascade,
  supply      int check (supply is null or supply between 1 and 100000),   -- null = limit not set yet (admin)
  sold        int not null default 0 check (sold >= 0),
  sold_out_at timestamptz,
  updated_at  timestamptz not null default now(),
  check (supply is null or sold <= supply)
);
create table if not exists public.user_board_collections (
  id          uuid primary key default gen_random_uuid(),                 -- the copy's unique ID
  user_id     uuid not null references public.profiles(id) on delete cascade,
  board_slug  text not null references public.board_catalog(slug) on update cascade,
  serial      int not null check (serial >= 1),
  price_paid  int not null check (price_paid >= 0),
  acquired_at timestamptz not null default now(),
  unique (board_slug, serial),
  unique (user_id, board_slug)
);
create index if not exists user_board_collections_user_idx on public.user_board_collections (user_id);
create table if not exists public.board_purchase_history (
  id            bigint generated always as identity primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  board_slug    text not null,
  serial        int not null,
  supply        int,
  price_paid    int not null,
  balance_after bigint,
  idem_key      text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, idem_key)
);
create index if not exists board_purchase_history_time_idx on public.board_purchase_history (created_at desc);
alter table public.profiles add column if not exists collection_public boolean not null default true;

insert into public.board_catalog (slug, tier, icon, sort) values
  ('midnight-blue', 1, '🌙', 1), ('graphite', 2, '⚙️', 2), ('royal-wood', 3, '🪵', 3), ('emerald-board', 4, '💚', 4),
  ('cyber-purple', 5, '⚡', 5), ('royal-marble', 6, '🏆', 6), ('obsidian-gold', 7, '💎', 7), ('celestial-crown', 8, '👑', 8)
on conflict (slug) do nothing;
insert into public.board_inventory (slug, supply) values
  ('midnight-blue', null), ('graphite', null), ('royal-wood', null), ('emerald-board', null),
  ('cyber-purple', 200), ('royal-marble', 100), ('obsidian-gold', 80), ('celestial-crown', 30)
on conflict (slug) do nothing;

-- A copy, once issued, never changes (serial, owner, board, price, time). Rows only disappear with a deleted account.
create or replace function public._board_copy_frozen() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'collection rows are permanent' using errcode = 'P0001';
end $$;
create or replace trigger user_board_collections_frozen before update on public.user_board_collections
  for each row execute function public._board_copy_frozen();
-- the purchase log is append-only
create or replace trigger board_purchase_history_frozen before update or delete on public.board_purchase_history
  for each row execute function public._board_copy_frozen();

-- Stock rules: sold only goes up; a supply is set once (null → n ≥ sold) and never raised or lowered afterwards,
-- so a sold-out board can never be restocked.
create or replace function public._board_stock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.sold < old.sold then raise exception 'sold counter cannot go down' using errcode = 'P0001'; end if;
  if new.supply is distinct from old.supply then
    if old.supply is not null then raise exception 'supply is final' using errcode = 'P0001'; end if;
    if new.supply is null or new.supply < new.sold then raise exception 'supply below copies sold' using errcode = 'P0001'; end if;
  end if;
  if new.supply is not null and new.sold >= new.supply and new.sold_out_at is null then new.sold_out_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger board_inventory_guard before update on public.board_inventory
  for each row execute function public._board_stock_guard();

alter table public.board_catalog enable row level security;
alter table public.board_inventory enable row level security;
alter table public.user_board_collections enable row level security;
alter table public.board_purchase_history enable row level security;
create policy board_catalog_read on public.board_catalog for select to anon, authenticated using (true);
create policy board_inventory_read on public.board_inventory for select to anon, authenticated using (true);
-- collections and the purchase log are read through the functions below (they honour the privacy switch)
revoke all on public.board_catalog, public.board_inventory, public.user_board_collections, public.board_purchase_history from anon, authenticated;
grant select on public.board_catalog, public.board_inventory to anon, authenticated;
grant select, insert, update on public.board_catalog, public.board_inventory to service_role;
grant select, insert on public.user_board_collections, public.board_purchase_history to service_role;

/* ================================================================= buying a Limited board */
create or replace function public.board_buy(p_slug text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.shop_items; st public.board_inventory; price int; bal bigint; n int; prev public.board_purchase_history;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 80 then raise exception 'bad request key'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  insert into public.user_wallets (user_id) values (uid) on conflict do nothing;
  perform 1 from public.user_wallets where user_id = uid for update;          -- 1) this player: one purchase at a time
  select * into prev from public.board_purchase_history where user_id = uid and idem_key = p_key;
  if found then                                                                 -- retry of the same request
    return json_build_object('ok', true, 'duplicate', true, 'item', prev.board_slug, 'serial', prev.serial, 'supply', prev.supply,
                             'balance', (select balance from public.user_wallets where user_id = uid));
  end if;
  select * into i from public.shop_items where slug = p_slug;
  if not found or not i.active or not exists (select 1 from public.board_catalog where slug = p_slug) then raise exception 'item not found'; end if;
  if i.retired then raise exception 'item not for sale'; end if;
  if exists (select 1 from public.user_board_collections where user_id = uid and board_slug = p_slug) then raise exception 'already owned'; end if;
  select * into st from public.board_inventory where slug = p_slug for update;  -- 2) this board: copies issued one by one
  if st.supply is not null and st.sold >= st.supply then raise exception 'sold out' using errcode = 'P0001'; end if;
  n := st.sold + 1;
  price := public._final_price(i);
  bal := (select balance from public.user_wallets where user_id = uid);
  if price > 0 then
    bal := public._wallet_apply(uid, -price, 'purchase', 'board', p_slug || '#' || n, 'buy:' || p_key, i.name_en || ' #' || n, null);
  end if;
  update public.board_inventory set sold = n where slug = p_slug;
  insert into public.user_board_collections (user_id, board_slug, serial, price_paid) values (uid, p_slug, n, price);
  insert into public.user_inventory (user_id, item_slug, source) values (uid, p_slug, 'purchase') on conflict do nothing;
  insert into public.shop_purchases (user_id, item_slug, price_paid, idem_key) values (uid, p_slug, price, p_key) on conflict do nothing;
  insert into public.board_purchase_history (user_id, board_slug, serial, supply, price_paid, balance_after, idem_key)
  values (uid, p_slug, n, st.supply, price, bal, p_key);
  return json_build_object('ok', true, 'item', p_slug, 'serial', n, 'supply', st.supply, 'price', price, 'balance', bal);
end $$;

-- The generic shop purchase hands Limited boards to board_buy (so they always get a serial).
create or replace function public.shop_buy(p_slug text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.shop_items; price int; bal bigint;
begin
  if exists (select 1 from public.board_catalog where slug = p_slug) then return public.board_buy(p_slug, p_key); end if;
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

/* ================================================================= reading: shop stock, collections */
-- Shop: every Limited board with its stock (public, also for guests).
create or replace function public.board_catalog_list() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'slug', c.slug, 'tier', c.tier, 'icon', c.icon, 'supply', s.supply, 'sold', s.sold,
           'name_uz', i.name_uz, 'name_en', i.name_en, 'rarity', i.rarity, 'image_url', i.image_url,
           'remaining', case when s.supply is null then null else greatest(s.supply - s.sold, 0) end,
           'sold_out', s.supply is not null and s.sold >= s.supply,
           'mine', (select json_build_object('serial', u.serial, 'acquired_at', u.acquired_at) from public.user_board_collections u
                     where u.user_id = auth.uid() and u.board_slug = c.slug))
         order by c.sort), '[]'::json)
  from public.board_catalog c join public.board_inventory s on s.slug = c.slug
  join public.shop_items i on i.slug = c.slug where i.active;
$$;

-- A player's collection. Visible to everyone unless the owner hid it; the owner always sees it.
create or replace function public.board_collection_of(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; own boolean := (auth.uid() = p_user); total int; owned int; limited int;
begin
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'user not found'; end if;
  total := (select count(*) from public.board_catalog c join public.shop_items i on i.slug = c.slug where i.active);
  if not p.collection_public and not coalesce(own, false) then
    return json_build_object('visible', false, 'public', false, 'owner', p.username, 'total', total);
  end if;
  select count(*), count(*) filter (where s.supply is not null) into owned, limited
    from public.user_board_collections u join public.board_inventory s on s.slug = u.board_slug where u.user_id = p_user;
  return json_build_object(
    'visible', true, 'public', p.collection_public, 'mine', coalesce(own, false), 'owner', p.username,
    'total', total, 'owned', owned, 'limited', limited,
    'complete_pct', case when total = 0 then 0 else round(100.0 * owned / total) end,
    'items', (select coalesce(json_agg(json_build_object(
                'id', u.id, 'slug', u.board_slug, 'serial', u.serial, 'supply', s.supply, 'acquired_at', u.acquired_at,
                'tier', c.tier, 'icon', c.icon, 'rarity', i.rarity, 'name_uz', i.name_uz, 'name_en', i.name_en, 'image_url', i.image_url,
                'style', i.style)
              order by c.tier desc, s.supply asc nulls last, u.serial), '[]'::json)
              from public.user_board_collections u join public.board_catalog c on c.slug = u.board_slug
              join public.board_inventory s on s.slug = u.board_slug join public.shop_items i on i.slug = u.board_slug
              where u.user_id = p_user));
end $$;

create or replace function public.collection_set_public(p_public boolean) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.profiles set collection_public = coalesce(p_public, true) where id = uid;
  return json_build_object('ok', true, 'public', coalesce(p_public, true));
end $$;

create or replace function public.board_purchases_mine(p_limit int default 30)
returns table (board_slug text, serial int, supply int, price_paid int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.board_slug, h.serial, h.supply, h.price_paid, h.created_at from public.board_purchase_history h
  where h.user_id = auth.uid() order by h.id desc limit greatest(1, least(p_limit, 100));
$$;

/* ================================================================= pricing: Coin ↔ Stars rate, packages, history */
create table if not exists public.pricing_settings (
  id             boolean primary key default true check (id),
  stars_per_1000 numeric(10, 3) not null default 25 check (stars_per_1000 > 0 and stars_per_1000 <= 10000),
  som_per_coin   numeric(10, 3) not null default 10 check (som_per_coin >= 0 and som_per_coin <= 100000),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);
insert into public.pricing_settings (id) values (true) on conflict do nothing;
alter table public.pricing_settings enable row level security;
create policy pricing_settings_read on public.pricing_settings for select to anon, authenticated using (true);
revoke all on public.pricing_settings from anon, authenticated;
grant select on public.pricing_settings to anon, authenticated;
grant select, insert, update on public.pricing_settings to service_role;

create table if not exists public.price_history (
  id         bigint generated always as identity primary key,
  entity     text not null check (entity in ('package', 'board', 'item', 'rate')),
  entity_id  text not null,
  field      text not null,
  old_value  numeric,
  new_value  numeric,
  admin_id   uuid references public.profiles(id) on delete set null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists price_history_time_idx on public.price_history (created_at desc);
alter table public.price_history enable row level security;
revoke all on public.price_history from anon, authenticated;
grant select, insert on public.price_history to service_role;

alter table public.coin_packages add column if not exists stars_manual boolean not null default false;

-- whole Stars, rounded up (Telegram only takes integers): 500 coins × 25 / 1000 = 12.5 → 13
create or replace function public._stars_for(p_coins int) returns int
language sql stable set search_path = public as $$
  select greatest(1, ceil(p_coins * (select stars_per_1000 from public.pricing_settings where id) / 1000.0)::int);
$$;

-- every price change lands in price_history (admin and reason come from the calling admin function, when there is one)
create or replace function public._log_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid := auth.uid(); r text := nullif(current_setting('dameo.reason', true), '');
begin
  if tg_table_name = 'coin_packages' then
    if tg_op = 'INSERT' or new.stars is distinct from old.stars then
      insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason)
      values ('package', new.id, 'stars', case when tg_op = 'UPDATE' then old.stars end, new.stars, a, r);
    end if;
    if tg_op = 'UPDATE' and new.coins is distinct from old.coins then
      insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason) values ('package', new.id, 'coins', old.coins, new.coins, a, r);
    end if;
  elsif tg_table_name = 'shop_items' then
    if tg_op = 'UPDATE' and (new.price is distinct from old.price or new.discount_percent is distinct from old.discount_percent) then
      insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason)
      values (case when new.collection = 'limited' then 'board' else 'item' end, new.slug, 'price',
              public._final_price(old), public._final_price(new), a, r);
    end if;
  elsif tg_table_name = 'pricing_settings' then
    if new.stars_per_1000 is distinct from old.stars_per_1000 then
      insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason) values ('rate', 'coin_stars', 'stars_per_1000', old.stars_per_1000, new.stars_per_1000, a, r);
    end if;
    if new.som_per_coin is distinct from old.som_per_coin then
      insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason) values ('rate', 'coin_som', 'som_per_coin', old.som_per_coin, new.som_per_coin, a, r);
    end if;
  end if;
  return new;
end $$;
create or replace trigger coin_packages_price_log after insert or update on public.coin_packages for each row execute function public._log_price();
create or replace trigger shop_items_price_log after update on public.shop_items for each row execute function public._log_price();
create or replace trigger pricing_settings_log after update on public.pricing_settings for each row execute function public._log_price();

-- the new package line-up (1 000 coins = 25 Stars). Old bigger packages are switched off, not deleted.
update public.coin_packages set active = false, updated_at = now() where id not in ('coins_500', 'coins_1k', 'coins_1200', 'coins_1800', 'coins_2200', 'coins_3k', 'coins_4k', 'coins_5k');
select set_config('dameo.reason', 'v3.2: 1000 Coin = 25 Stars', true);
insert into public.coin_packages (id, coins, stars, active, sort, stars_manual) values
  ('coins_500', 500, public._stars_for(500), true, 1, false), ('coins_1k', 1000, public._stars_for(1000), true, 2, false),
  ('coins_1200', 1200, public._stars_for(1200), true, 3, false), ('coins_1800', 1800, public._stars_for(1800), true, 4, false),
  ('coins_2200', 2200, public._stars_for(2200), true, 5, false), ('coins_3k', 3000, public._stars_for(3000), true, 6, false),
  ('coins_4k', 4000, public._stars_for(4000), true, 7, false), ('coins_5k', 5000, public._stars_for(5000), true, 8, false)
on conflict (id) do update set coins = excluded.coins, stars = excluded.stars, active = true, sort = excluded.sort,
                               stars_manual = false, bonus_coins = 0, updated_at = now();
update public.coin_packages set stars = public._stars_for(coins + bonus_coins), updated_at = now() where not stars_manual and not active;

-- Admin: package save. `stars_manual: true` pins the Stars price; otherwise it is computed from the rate.
-- (A request without `stars_manual` but with `stars` is a manual price, as in the old admin panel.)
create or replace function public.admin_package_save(p jsonb, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason);
        c int := (p->>'coins')::int; b int := coalesce((p->>'bonus_coins')::int, 0);
        manual boolean := coalesce((p->>'stars_manual')::boolean, p ? 'stars'); s int;
begin
  if p->>'id' is null or p->>'id' !~ '^[a-z0-9_-]{2,32}$' then raise exception 'bad package id'; end if;
  if c is null or c < 1 or c > 10000000 then raise exception 'bad coins'; end if;
  if b < 0 or b > 10000000 then raise exception 'bad bonus'; end if;
  s := case when manual then (p->>'stars')::int else public._stars_for(c + b) end;
  if s is null or s < 1 or s > 100000 then raise exception 'bad stars'; end if;
  perform set_config('dameo.reason', r, true);
  insert into public.coin_packages (id, coins, bonus_coins, stars, stars_manual, active, sort, updated_at)
  values (p->>'id', c, b, s, manual, coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0), now())
  on conflict (id) do update set coins = excluded.coins, bonus_coins = excluded.bonus_coins, stars = excluded.stars,
                                 stars_manual = excluded.stars_manual, active = excluded.active, sort = excluded.sort, updated_at = now();
  perform public._audit(uid, 'package.save', 'package', p->>'id', r, p || jsonb_build_object('stars', s, 'stars_manual', manual));
  return json_build_object('ok', true, 'stars', s, 'stars_manual', manual);
end $$;

create or replace function public.admin_pricing() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('payments.view');
begin
  return json_build_object('settings', (select row_to_json(s) from public.pricing_settings s where id),
    'packages', (select coalesce(json_agg(row_to_json(c) order by c.sort, c.coins), '[]'::json) from public.coin_packages c));
end $$;

-- Change the rate: every automatic package is re-priced in the same transaction; manual prices stay as they are.
create or replace function public.admin_pricing_set(p_stars_per_1000 numeric, p_som_per_coin numeric, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason); n int;
begin
  if p_stars_per_1000 is null or p_stars_per_1000 <= 0 or p_stars_per_1000 > 10000 then raise exception 'bad rate'; end if;
  if p_som_per_coin is null or p_som_per_coin < 0 or p_som_per_coin > 100000 then raise exception 'bad som rate'; end if;
  perform set_config('dameo.reason', r, true);
  update public.pricing_settings set stars_per_1000 = p_stars_per_1000, som_per_coin = p_som_per_coin, updated_at = now(), updated_by = uid where id;
  update public.coin_packages set stars = public._stars_for(coins + bonus_coins), updated_at = now()
   where not stars_manual and stars is distinct from public._stars_for(coins + bonus_coins);
  get diagnostics n = row_count;
  perform public._audit(uid, 'pricing.rate', 'pricing', 'coin_stars', r, jsonb_build_object('stars_per_1000', p_stars_per_1000, 'som_per_coin', p_som_per_coin, 'repriced', n));
  return json_build_object('ok', true, 'repriced', n);
end $$;

create or replace function public.admin_price_history(p_limit int default 50)
returns table (id bigint, entity text, entity_id text, field text, old_value numeric, new_value numeric, admin text, reason text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('payments.view');
begin
  return query select h.id, h.entity, h.entity_id, h.field, h.old_value, h.new_value, (select pp.username from public.profiles pp where pp.id = h.admin_id),
                      h.reason, h.created_at
               from public.price_history h order by h.id desc limit greatest(1, least(p_limit, 200));
end $$;

/* ================================================================= admin: Limited boards */
create or replace function public.admin_boards() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return (select coalesce(json_agg(json_build_object(
            'slug', c.slug, 'name', i.name_en, 'rarity', i.rarity, 'tier', c.tier, 'price', i.price, 'final_price', public._final_price(i),
            'active', i.active, 'retired', i.retired, 'supply', s.supply, 'sold', s.sold, 'sold_out_at', s.sold_out_at, 'image_url', i.image_url,
            'revenue', (select coalesce(sum(price_paid), 0) from public.user_board_collections u where u.board_slug = c.slug))
          order by c.sort), '[]'::json)
          from public.board_catalog c join public.board_inventory s on s.slug = c.slug join public.shop_items i on i.slug = c.slug);
end $$;

-- price in coins; the copies limit only when it is not set yet
create or replace function public.admin_board_save(p_slug text, p_price int, p_supply int, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason); s public.board_inventory;
begin
  if not exists (select 1 from public.board_catalog where slug = p_slug) then raise exception 'item not found'; end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then raise exception 'bad price'; end if;
  perform set_config('dameo.reason', r, true);
  update public.shop_items set price = p_price, updated_at = now() where slug = p_slug and price is distinct from p_price;
  select * into s from public.board_inventory where slug = p_slug for update;
  if p_supply is not null and p_supply is distinct from s.supply then
    update public.board_inventory set supply = p_supply where slug = p_slug;   -- guarded: once, ≥ sold
  end if;
  perform public._audit(uid, 'board.save', 'board', p_slug, r, jsonb_build_object('price', p_price, 'supply', p_supply));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_board_owners(p_slug text, p_limit int default 100)
returns table (serial int, user_id uuid, username text, price_paid int, acquired_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return query select u.serial, u.user_id, p.username, u.price_paid, u.acquired_at
               from public.user_board_collections u join public.profiles p on p.id = u.user_id
               where u.board_slug = p_slug order by u.serial limit greatest(1, least(p_limit, 500));
end $$;

/* ================================================================= grants */
revoke all on function public.board_buy(text, text), public.board_catalog_list(), public.board_collection_of(uuid), public.collection_set_public(boolean),
  public.board_purchases_mine(int), public.admin_pricing(), public.admin_pricing_set(numeric, numeric, text), public.admin_price_history(int),
  public.admin_boards(), public.admin_board_save(text, int, int, text), public.admin_board_owners(text, int), public._stars_for(int),
  public._log_price(), public._board_stock_guard(), public._board_copy_frozen() from public, anon, authenticated;
grant execute on function public.board_catalog_list(), public.board_collection_of(uuid) to anon, authenticated;
grant execute on function public.board_buy(text, text), public.collection_set_public(boolean), public.board_purchases_mine(int),
  public.admin_pricing(), public.admin_pricing_set(numeric, numeric, text), public.admin_price_history(int),
  public.admin_boards(), public.admin_board_save(text, int, int, text), public.admin_board_owners(text, int) to authenticated;
grant execute on function public._stars_for(int) to service_role;
