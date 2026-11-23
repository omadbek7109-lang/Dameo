-- One avatar frame at a time (0042). Scratch database ONLY.
\set ON_ERROR_STOP 1
create table if not exists public._f_results (name text, ok boolean); grant all on public._f_results to public;
truncate public._f_results;
create or replace function public._f(n text, c boolean) returns void language sql security definer as $$ insert into public._f_results values (n, coalesce(c, false)) $$;
create or replace function public._fu(k int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad((900 + k)::text, 12, '0'))::uuid $$;
insert into auth.users (id, email, raw_user_meta_data) select public._fu(k), 'f' || k || '@x', jsonb_build_object('username', 'f' || k) from generate_series(1, 3) k;
insert into public.user_frames (user_id, frame_slug, price_paid, idem_key) values (public._fu(1), 'crimson-queen', 0, 'tf1'), (public._fu(3), 'crimson-queen', 0, 'tf3');
insert into public.pass_cosmetics (user_id, kind, id, season) select public._fu(k), 'frame', 'f-laurel', 1 from generate_series(1, 3) k;
-- 1 wears the bought frame, 2 the classic one, 3 nothing
update public.profiles set equipped_frame_item = 'crimson-queen' where id = public._fu(1);
update public.profiles set equipped_frame = 'dameo' where id = public._fu(2);
-- the automatic wear on claim (insert … do nothing)
insert into public.pass_equipped (user_id, kind, id) select public._fu(k), 'frame', 'f-laurel' from generate_series(1, 3) k on conflict do nothing;
select public._f('bought frame keeps its place on claim', not exists (select 1 from public.pass_equipped where user_id = public._fu(1) and kind = 'frame'));
select public._f('classic frame gives way on claim', (select equipped_frame is null from public.profiles where id = public._fu(2))
       and exists (select 1 from public.pass_equipped where user_id = public._fu(2) and kind = 'frame'));
select public._f('frames_active: one row per player', (select count(*) = count(distinct user_id) from public.frames_active() where user_id in (public._fu(1), public._fu(2), public._fu(3))));
select public._f('frames_active shows pass frames', (select frame from public.frames_active() where user_id = public._fu(2)) = 'f-laurel'
       and (select frame from public.frames_active() where user_id = public._fu(3)) = 'f-laurel'
       and (select frame from public.frames_active() where user_id = public._fu(1)) = 'crimson-queen');
-- player 1 puts the pass frame on by hand
set role authenticated;
select set_config('request.jwt.claim.sub', public._fu(1)::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
select public._f('pass_equip frame ok', (public.pass_equip('frame', 'f-laurel') ->> 'ok')::boolean);
reset role;
select public._f('bought frame came off', (select equipped_frame_item is null and equipped_frame is null from public.profiles where id = public._fu(1)));
select public._f('frames_active -> pass frame', (select frame from public.frames_active() where user_id = public._fu(1)) = 'f-laurel');
-- and back to the bought frame
set role authenticated;
select public._f('frame_equip ok', (public.frame_equip('crimson-queen') ->> 'ok')::boolean);
reset role;
select public._f('pass frame came off', not exists (select 1 from public.pass_equipped where user_id = public._fu(1) and kind = 'frame'));
select public._f('frames_active -> bought frame', (select frame from public.frames_active() where user_id = public._fu(1)) = 'crimson-queen');
-- frame_equip(null) does not touch the pass frame of player 2
select set_config('request.jwt.claim.sub', public._fu(2)::text, false);
set role authenticated;
select public.frame_equip(null);
reset role;
select public._f('taking the shop frame off keeps the pass frame', exists (select 1 from public.pass_equipped where user_id = public._fu(2) and kind = 'frame'));
select name, ok from public._f_results order by ok, name;
