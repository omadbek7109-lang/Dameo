-- One avatar frame at a time.
-- Shop frames (profiles.equipped_frame / equipped_frame_item) and DAMEO Pass frames (pass_equipped kind 'frame')
-- used to be two separate slots, so a player could show two frames on top of each other, and Pass frames were
-- only drawn on the profile page. Now:
--  * wearing a Pass frame takes the shop frame off, wearing a shop frame takes the Pass frame off;
--  * claiming a Pass frame wears it automatically only if the player does not wear a bought frame or the
--    champion frame (the free classic frame gives way);
--  * frames_active() also lists Pass frames, so everyone sees them everywhere (rating, games, chat …).

-- a Pass frame being worn: skip the automatic wear-on-claim if a bought/champion frame is on
create or replace function public._pass_frame_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'frame' and exists (select 1 from public.profiles p where p.id = new.user_id
                                      and (p.equipped_frame_item is not null or p.equipped_frame = 'champion')) then
    return null;
  end if;
  return new;
end $$;

-- a Pass frame is on: the shop frame comes off
create or replace function public._pass_frame_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'frame' then
    update public.profiles set equipped_frame = null, equipped_frame_item = null
     where id = new.user_id and (equipped_frame is not null or equipped_frame_item is not null);
  end if;
  return null;
end $$;

-- a shop frame is on: the Pass frame comes off
create or replace function public._shop_frame_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.equipped_frame is not null or new.equipped_frame_item is not null then
    delete from public.pass_equipped where user_id = new.id and kind = 'frame';
  end if;
  return null;
end $$;
revoke all on function public._pass_frame_before(), public._pass_frame_after(), public._shop_frame_after() from public, anon, authenticated;

drop trigger if exists pass_frame_before on public.pass_equipped;
create trigger pass_frame_before before insert on public.pass_equipped
  for each row when (new.kind = 'frame') execute function public._pass_frame_before();
drop trigger if exists pass_frame_after on public.pass_equipped;
create trigger pass_frame_after after insert or update on public.pass_equipped
  for each row when (new.kind = 'frame') execute function public._pass_frame_after();
drop trigger if exists shop_frame_after on public.profiles;
create trigger shop_frame_after after update of equipped_frame, equipped_frame_item on public.profiles
  for each row when ((new.equipped_frame is not null or new.equipped_frame_item is not null)
                     and (new.equipped_frame is distinct from old.equipped_frame
                          or new.equipped_frame_item is distinct from old.equipped_frame_item))
  execute function public._shop_frame_after();

-- Pass frames now take the shop slot when the Pass frame was put on later. pass_equip clears the shop frame
-- first, so the before-trigger lets a chosen Pass frame through even over a bought one.
create or replace function public.pass_equip(p_kind text, p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_kind not in ('emoji', 'frame', 'background', 'badge', 'title', 'victory') then return json_build_object('ok', false); end if;
  if p_id is null then
    delete from public.pass_equipped where user_id = uid and kind = p_kind;
    return json_build_object('ok', true);
  end if;
  if not exists (select 1 from public.pass_cosmetics c where c.user_id = uid and c.kind = p_kind and c.id = p_id
                   and (c.until is null or c.until > now())) then
    return json_build_object('ok', false);
  end if;
  if p_kind = 'frame' then
    update public.profiles set equipped_frame = null, equipped_frame_item = null
     where id = uid and (equipped_frame is not null or equipped_frame_item is not null);
  end if;
  insert into public.pass_equipped (user_id, kind, id) values (uid, p_kind, p_id)
  on conflict (user_id, kind) do update set id = excluded.id;
  return json_build_object('ok', true);
end $$;
revoke all on function public.pass_equip(text, text) from public, anon;
grant execute on function public.pass_equip(text, text) to authenticated;

-- frames everyone sees: bought frame > Pass frame > classic / champion
create or replace function public.frames_active() returns table (user_id uuid, frame text)
language sql stable security definer set search_path = public as $$
  select p.id, p.equipped_frame_item from public.profiles p
   where p.equipped_frame_item is not null
     and exists (select 1 from public.user_frames f where f.user_id = p.id and f.frame_slug = p.equipped_frame_item)
  union all
  select q.user_id, q.id from public.pass_equipped q
    join public.pass_cosmetics c on c.user_id = q.user_id and c.kind = 'frame' and c.id = q.id and (c.until is null or c.until > now())
    join public.profiles p on p.id = q.user_id and p.equipped_frame_item is null
   where q.kind = 'frame'
  union all
  select p.id, p.equipped_frame from public.profiles p
   where p.equipped_frame_item is null and p.equipped_frame = 'dameo'
     and not exists (select 1 from public.pass_equipped q where q.user_id = p.id and q.kind = 'frame')
  union all
  select p.id, 'champion'::text from public.profiles p
   where p.equipped_frame_item is null and p.equipped_frame = 'champion' and p.id = public._rating_leader()
     and not exists (select 1 from public.pass_equipped q where q.user_id = p.id and q.kind = 'frame');
$$;

-- players who already wear two frames: a bought/champion frame stays, otherwise the Pass frame stays
delete from public.pass_equipped q using public.profiles p
 where q.kind = 'frame' and p.id = q.user_id and (p.equipped_frame_item is not null or p.equipped_frame = 'champion');
update public.profiles p set equipped_frame = null
 where p.equipped_frame = 'dameo' and exists (select 1 from public.pass_equipped q where q.user_id = p.id and q.kind = 'frame');
