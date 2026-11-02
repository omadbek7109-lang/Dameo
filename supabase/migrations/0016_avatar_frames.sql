-- 0016: avatar frames (not for sale).
--   'champion' — only the current #1 of the rating may wear it; if they lose #1 it stops showing (and shows again if they win it back)
--   'dameo'    — free for everyone, put on / take off at will
-- Additive: one nullable column (players cannot write it directly — profiles UPDATE is granted per column), 4 functions.
alter table public.profiles add column if not exists equipped_frame text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_equipped_frame_check') then
    alter table public.profiles add constraint profiles_equipped_frame_check check (equipped_frame in ('champion', 'dameo'));
  end if;
end $$;

-- the #1 of the rating (same order as the leaderboard view)
create or replace function public._rating_leader() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles order by rating desc, wins desc, created_at asc limit 1;
$$;

-- frames visible right now, for every avatar on screen
create or replace function public.frames_active() returns table (user_id uuid, frame text)
language sql stable security definer set search_path = public as $$
  select p.id, p.equipped_frame from public.profiles p where p.equipped_frame = 'dameo'
  union all
  select p.id, 'champion'::text from public.profiles p where p.equipped_frame = 'champion' and p.id = public._rating_leader();
$$;

create or replace function public.frames_mine() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return (select json_build_object('equipped', p.equipped_frame, 'champion_ok', p.id = public._rating_leader())
            from public.profiles p where p.id = uid);
end $$;

create or replace function public.frame_equip(p_frame text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_frame is not null and p_frame not in ('champion', 'dameo') then raise exception 'bad frame'; end if;
  if p_frame = 'champion' and uid is distinct from public._rating_leader() then
    raise exception 'only the #1 player can wear this frame';
  end if;
  update public.profiles set equipped_frame = p_frame where id = uid;
  return json_build_object('ok', true, 'equipped', p_frame);
end $$;

revoke all on function public._rating_leader(), public.frames_active(), public.frames_mine(), public.frame_equip(text) from public, anon, authenticated;
grant execute on function public.frames_active() to anon, authenticated;
grant execute on function public.frames_mine(), public.frame_equip(text) to authenticated;
