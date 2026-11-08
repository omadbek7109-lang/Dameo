-- DAMEO 0023 (v3.2): the shop keeps only the 8 Stones Collection piece sets.
-- The older piece sets (incl. the Football collection) leave the shop: active = false, retired = true — nothing is
-- deleted. Players who own one keep it in their inventory and whatever they have equipped keeps working.
-- A backup of the rows is taken first. Shop tabs left without anything on sale are hidden (visible = false).

create table if not exists public._backup_v32_piece_items as select now() as backed_up_at, i.* from public.shop_items i where i.slot = 'piece';
create table if not exists public._backup_v32_piece_inventory as
  select now() as backed_up_at, v.* from public.user_inventory v join public.shop_items i on i.slug = v.item_slug where i.slot = 'piece';
create table if not exists public._backup_v32_equipped_pieces as
  select now() as backed_up_at, p.id as user_id, p.equipped_piece from public.profiles p where p.equipped_piece is not null;
alter table public._backup_v32_piece_items enable row level security;
alter table public._backup_v32_piece_inventory enable row level security;
alter table public._backup_v32_equipped_pieces enable row level security;
revoke all on public._backup_v32_piece_items, public._backup_v32_piece_inventory, public._backup_v32_equipped_pieces from anon, authenticated;

update public.shop_items set active = false, retired = true, updated_at = now()
 where slot = 'piece' and collection <> 'stones' and active;

update public.shop_categories c set visible = false
 where c.id in ('pieces', 'football', 'premium', 'trend')
   and not exists (select 1 from public.shop_items i where i.category_id = c.id and i.active);
