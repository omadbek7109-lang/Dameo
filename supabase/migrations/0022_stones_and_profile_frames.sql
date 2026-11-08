-- DAMEO 0022 (v3.2): Stones Collection + Profile Frames.
--
-- Stones Collection (piece sets drawn from the "DAMEO STONES COLLECTION" artwork, images in /stones/)
--  * New shop category 'stones' with 8 piece sets (slot 'piece', collection 'stones'). Classic Stone is free for everyone.
--  * The 4 Limited stones join the existing Limited system (board_catalog / board_inventory / user_board_collections /
--    board_purchase_history from 0020 — those tables hold every Limited item, boards and stones): one transaction,
--    unique serials (#024/100), SOLD OUT for good, no overselling under concurrent purchases.
--  * Board-only readers (board_catalog_list, board_collection_of) are narrowed to boards; limited_stock(slot) serves both.
--  * The older piece sets stay on sale in their own tab; nothing is removed.
--
-- Profile Frames (artwork rings around the avatar, images in /frames/)
--  * frame_items (catalogue, admin-priced), user_frames (ownership, one row per frame), profiles.equipped_frame_item.
--  * frame_buy: server-side coin debit (same ledger as the shop), idempotent per request key, never twice per frame.
--  * frame_equip / frames_active / frames_mine keep working for the free 'dameo' (Classic) and 'champion' frames.
-- Additive only: new rows, tables, one nullable column; functions replaced with compatible signatures.

/* ================================================================= Stones Collection */
insert into public.shop_categories (id, name_uz, name_en, sort, visible) values
  ('stones', 'Toshlar', 'Stones', 0, true),
  ('frames', 'Ramkalar', 'Frames', 7, true)
on conflict (id) do nothing;

insert into public.shop_items (slug, category_id, slot, collection, name_uz, name_en, desc_uz, desc_en, rarity, price, is_free, is_default,
                               active, retired, style, image_url, sort)
values
  ('st-classic', 'stones', 'piece', 'stones', 'Classic Stone', 'Classic Stone', 'Klassik oq va qora toshlar.', 'Classic white and black stones.', 'common', 0, true, false, true, false,
   '{"w":{"tex":"st-classic-w","ring":"rgba(255,255,255,.55)","crown":"#c9a227"},"b":{"tex":"st-classic-b","ring":"rgba(150,160,180,.45)","crown":"#e8bb4d"}}', 'stones/st-classic.webp', 1),
  ('st-royal-gold', 'stones', 'piece', 'stones', 'Royal Gold', 'Royal Gold', 'Oltin toj tushirilgan qirollik toshlari.', 'Royal stones with a golden crown.', 'rare', 500, false, false, true, false,
   '{"w":{"tex":"st-royal-gold-w","ring":"#f3c24f","crown":"#fff1c1","anim":"gleam"},"b":{"tex":"st-royal-gold-b","ring":"#b8862b","crown":"#ffd56b","anim":"gleam"}}', 'stones/st-royal-gold.webp', 2),
  ('st-obsidian', 'stones', 'piece', 'stones', 'Obsidian', 'Obsidian', 'Qora obsidian, oltin tomirlar.', 'Black obsidian with golden veins.', 'rare', 1200, false, false, true, false,
   '{"w":{"tex":"st-obsidian-w","ring":"#d8dde8","crown":"#ffb02e","anim":"gleam"},"b":{"tex":"st-obsidian-b","ring":"#3a3530","crown":"#ffb02e","anim":"gleam"}}', 'stones/st-obsidian.webp', 3),
  ('st-sapphire', 'stones', 'piece', 'stones', 'Sapphire', 'Sapphire', 'Ko''k sapfir, kumush gardish.', 'Blue sapphire in a silver rim.', 'epic', 1800, false, false, true, false,
   '{"w":{"tex":"st-sapphire-w","ring":"#e6ecf7","crown":"#ffffff","glow":"rgba(80,140,255,.45)","anim":"gleam"},"b":{"tex":"st-sapphire-b","ring":"#1b2f6b","crown":"#cfe0ff","anim":"gleam"}}', 'stones/st-sapphire.webp', 4),
  ('st-emerald', 'stones', 'piece', 'stones', 'Emerald', 'Emerald', 'Zumrad, oltin gardish.', 'Emerald in a golden rim.', 'epic', 2200, false, false, true, false,
   '{"w":{"tex":"st-emerald-w","ring":"#f1e3b0","crown":"#fff1c1","glow":"rgba(40,200,120,.4)","anim":"gleam"},"b":{"tex":"st-emerald-b","ring":"#0f3d24","crown":"#ffd56b","anim":"gleam"}}', 'stones/st-emerald.webp', 5),
  ('st-ruby', 'stones', 'piece', 'stones', 'Ruby', 'Ruby', 'Yoqut, oltin gardish.', 'Ruby in a golden rim.', 'legendary', 3000, false, false, true, false,
   '{"w":{"tex":"st-ruby-w","ring":"#f6d27a","crown":"#fff1c1","glow":"rgba(255,60,90,.4)","anim":"gleam"},"b":{"tex":"st-ruby-b","ring":"#4a0c18","crown":"#ffd56b","anim":"gleam"}}', 'stones/st-ruby.webp', 6),
  ('st-diamond', 'stones', 'piece', 'stones', 'Diamond', 'Diamond', 'Olmos qirralar, oltin gardish.', 'Diamond facets in a golden rim.', 'legendary', 4000, false, false, true, false,
   '{"w":{"tex":"st-diamond-w","ring":"#ffffff","crown":"#e8bb4d","glow":"rgba(200,225,255,.5)","anim":"gleam"},"b":{"tex":"st-diamond-b","ring":"#5b6680","crown":"#ffd56b","anim":"gleam"}}', 'stones/st-diamond.webp', 7),
  ('st-celestial', 'stones', 'piece', 'stones', 'Celestial', 'Celestial', 'Galaktika va oltin toj.', 'A galaxy under a golden crown.', 'mythic', 5000, false, false, true, false,
   '{"w":{"tex":"st-celestial-w","ring":"#f3c24f","crown":"#fff1c1","glow":"rgba(140,110,255,.5)","anim":"gleam"},"b":{"tex":"st-celestial-b","ring":"#2a1d6b","crown":"#ffd56b","anim":"gleam"}}', 'stones/st-celestial.webp', 8)
on conflict (slug) do nothing;

-- the Limited stones in the shared Limited tables (tier 5–8: rarest last)
insert into public.board_catalog (slug, tier, icon, sort) values
  ('st-emerald', 5, '💚', 105), ('st-ruby', 6, '❤️', 106), ('st-diamond', 7, '💎', 107), ('st-celestial', 8, '👑', 108)
on conflict (slug) do nothing;
insert into public.board_inventory (slug, supply) values
  ('st-emerald', 200), ('st-ruby', 100), ('st-diamond', 80), ('st-celestial', 30)
on conflict (slug) do nothing;

-- stock of the Limited items of one kind ('board' | 'piece'), public
create or replace function public.limited_stock(p_slot text) returns json
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
  join public.shop_items i on i.slug = c.slug where i.active and i.slot = p_slot;
$$;
create or replace function public.board_catalog_list() returns json
language sql stable security definer set search_path = public as $$ select public.limited_stock('board'); $$;

-- the board collection stays boards-only (stones are shown in the shop with their serial)
create or replace function public.board_collection_of(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; own boolean := (auth.uid() = p_user); total int; owned int; limited int;
begin
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'user not found'; end if;
  total := (select count(*) from public.board_catalog c join public.shop_items i on i.slug = c.slug where i.active and i.slot = 'board');
  if not p.collection_public and not coalesce(own, false) then
    return json_build_object('visible', false, 'public', false, 'owner', p.username, 'total', total);
  end if;
  select count(*), count(*) filter (where s.supply is not null) into owned, limited
    from public.user_board_collections u join public.board_inventory s on s.slug = u.board_slug
    join public.shop_items i on i.slug = u.board_slug where u.user_id = p_user and i.slot = 'board';
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
              where u.user_id = p_user and i.slot = 'board'));
end $$;

-- admin list of every Limited item now also says what it is
create or replace function public.admin_boards() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return (select coalesce(json_agg(json_build_object(
            'slug', c.slug, 'name', i.name_en, 'slot', i.slot, 'rarity', i.rarity, 'tier', c.tier, 'price', i.price, 'final_price', public._final_price(i),
            'active', i.active, 'retired', i.retired, 'supply', s.supply, 'sold', s.sold, 'sold_out_at', s.sold_out_at, 'image_url', i.image_url,
            'revenue', (select coalesce(sum(price_paid), 0) from public.user_board_collections u where u.board_slug = c.slug))
          order by i.slot, c.sort), '[]'::json)
          from public.board_catalog c join public.board_inventory s on s.slug = c.slug join public.shop_items i on i.slug = c.slug);
end $$;

/* ================================================================= Profile Frames */
create table if not exists public.frame_items (
  slug       text primary key check (slug ~ '^[a-z0-9-]{2,40}$' and slug not in ('dameo', 'champion')),
  name_uz    text not null check (length(name_uz) between 2 and 60),
  name_en    text not null check (length(name_en) between 2 and 60),
  price      int not null default 0 check (price between 0 and 10000000),
  active     boolean not null default true,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.user_frames (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  frame_slug  text not null references public.frame_items(slug) on update cascade,
  price_paid  int not null check (price_paid >= 0),
  idem_key    text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, frame_slug),
  unique (user_id, idem_key)
);
alter table public.profiles add column if not exists equipped_frame_item text references public.frame_items(slug) on update cascade;

insert into public.frame_items (slug, name_uz, name_en, price, sort) values
  ('crimson-queen', 'Crimson Queen', 'Crimson Queen', 400, 1),
  ('mystic-blossom', 'Mystic Blossom', 'Mystic Blossom', 500, 2),
  ('frost-guardian', 'Frost Guardian', 'Frost Guardian', 1000, 3),
  ('golden-legend', 'Golden Legend', 'Golden Legend', 1500, 4),
  ('dragon-fury', 'Dragon Fury', 'Dragon Fury', 2000, 5)
on conflict (slug) do nothing;

alter table public.frame_items enable row level security;
alter table public.user_frames enable row level security;
create policy frame_items_read on public.frame_items for select to anon, authenticated using (true);
revoke all on public.frame_items, public.user_frames from anon, authenticated;
grant select on public.frame_items to anon, authenticated;
grant select, insert, update on public.frame_items to service_role;
grant select, insert on public.user_frames to service_role;

-- frames visible right now: a bought frame (while owned) wins over the free ones
create or replace function public.frames_active() returns table (user_id uuid, frame text)
language sql stable security definer set search_path = public as $$
  select p.id, p.equipped_frame_item from public.profiles p
   where p.equipped_frame_item is not null
     and exists (select 1 from public.user_frames f where f.user_id = p.id and f.frame_slug = p.equipped_frame_item)
  union all
  select p.id, p.equipped_frame from public.profiles p where p.equipped_frame_item is null and p.equipped_frame = 'dameo'
  union all
  select p.id, 'champion'::text from public.profiles p where p.equipped_frame_item is null and p.equipped_frame = 'champion' and p.id = public._rating_leader();
$$;

create or replace function public.frames_mine() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return (select json_build_object('equipped', coalesce(p.equipped_frame_item, p.equipped_frame), 'champion_ok', p.id = public._rating_leader(),
                                   'owned', (select coalesce(json_agg(f.frame_slug), '[]'::json) from public.user_frames f where f.user_id = uid))
            from public.profiles p where p.id = uid);
end $$;

create or replace function public.frame_equip(p_frame text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_frame is null then
    update public.profiles set equipped_frame = null, equipped_frame_item = null where id = uid;
  elsif p_frame in ('champion', 'dameo') then
    if p_frame = 'champion' and uid is distinct from public._rating_leader() then
      raise exception 'only the #1 player can wear this frame';
    end if;
    update public.profiles set equipped_frame = p_frame, equipped_frame_item = null where id = uid;
  else
    if not exists (select 1 from public.user_frames where user_id = uid and frame_slug = p_frame) then raise exception 'not owned'; end if;
    update public.profiles set equipped_frame_item = p_frame, equipped_frame = null where id = uid;
  end if;
  return json_build_object('ok', true, 'equipped', p_frame);
end $$;

-- shop list (prices from the database, owned flag for the caller)
create or replace function public.frame_catalog() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('slug', f.slug, 'name_uz', f.name_uz, 'name_en', f.name_en, 'price', f.price,
           'owned', exists (select 1 from public.user_frames u where u.user_id = auth.uid() and u.frame_slug = f.slug))
         order by f.sort, f.slug), '[]'::json)
  from public.frame_items f where f.active;
$$;

create or replace function public.frame_buy(p_slug text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); f public.frame_items; bal bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 80 then raise exception 'bad request key'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  insert into public.user_wallets (user_id) values (uid) on conflict do nothing;
  perform 1 from public.user_wallets where user_id = uid for update;          -- one purchase at a time per player
  if exists (select 1 from public.user_frames where user_id = uid and idem_key = p_key) then
    return json_build_object('ok', true, 'duplicate', true, 'balance', (select balance from public.user_wallets where user_id = uid));
  end if;
  select * into f from public.frame_items where slug = p_slug;
  if not found or not f.active then raise exception 'item not found'; end if;
  if exists (select 1 from public.user_frames where user_id = uid and frame_slug = p_slug) then raise exception 'already owned'; end if;
  bal := (select balance from public.user_wallets where user_id = uid);
  if f.price > 0 then
    bal := public._wallet_apply(uid, -f.price, 'purchase', 'frame', f.slug, 'frame:' || p_key, f.name_en || ' frame', null);
  end if;
  insert into public.user_frames (user_id, frame_slug, price_paid, idem_key) values (uid, f.slug, f.price, p_key);
  return json_build_object('ok', true, 'item', f.slug, 'price', f.price, 'balance', bal);
end $$;

-- admin: prices / names / on-off of the frames, logged in price_history + audit
create or replace function public.admin_frames() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage');
begin
  return (select coalesce(json_agg(json_build_object('slug', f.slug, 'name_uz', f.name_uz, 'name_en', f.name_en, 'price', f.price, 'active', f.active, 'sort', f.sort,
             'owners', (select count(*) from public.user_frames u where u.frame_slug = f.slug),
             'revenue', (select coalesce(sum(price_paid), 0) from public.user_frames u where u.frame_slug = f.slug)) order by f.sort), '[]'::json)
          from public.frame_items f);
end $$;

create or replace function public.admin_frame_save(p_slug text, p_price int, p_active boolean, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('shop.manage'); r text := public._need_reason(p_reason); f public.frame_items;
begin
  select * into f from public.frame_items where slug = p_slug for update;
  if not found then raise exception 'item not found'; end if;
  if p_price is null or p_price < 0 or p_price > 10000000 then raise exception 'bad price'; end if;
  update public.frame_items set price = p_price, active = coalesce(p_active, active), updated_at = now() where slug = p_slug;
  if f.price is distinct from p_price then
    insert into public.price_history (entity, entity_id, field, old_value, new_value, admin_id, reason) values ('item', 'frame:' || p_slug, 'price', f.price, p_price, uid, r);
  end if;
  perform public._audit(uid, 'frame.save', 'frame', p_slug, r, jsonb_build_object('price', p_price, 'active', p_active));
  return json_build_object('ok', true);
end $$;

/* ================================================================= grants */
revoke all on function public.limited_stock(text), public.frame_catalog(), public.frame_buy(text, text), public.admin_frames(),
  public.admin_frame_save(text, int, boolean, text) from public, anon, authenticated;
grant execute on function public.limited_stock(text), public.frame_catalog() to anon, authenticated;
grant execute on function public.frame_buy(text, text), public.admin_frames(), public.admin_frame_save(text, int, boolean, text) to authenticated;
