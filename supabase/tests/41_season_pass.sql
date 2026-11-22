-- DAMEO Pass (0041) scenario test. Scratch database ONLY (inserts test users, games and coins):
--   psql -d scratch -f 00_supabase_stub.sql -f ../migrations/*.sql -f 41_season_pass.sql
\set ON_ERROR_STOP 1
create table if not exists public._p_results (name text, ok boolean, detail text); grant all on public._p_results to public;
truncate public._p_results;
create or replace function public._p_check(n text, cond boolean, d text default '') returns void language plpgsql security definer as $$
begin insert into public._p_results values (n, coalesce(cond, false), d); end $$;
create or replace function public._uid(k int) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid $$;

-- players: 1 = D (tester), 2 = E, 3 = F, 4 = G, 5 = H, 9 = admin, 100.. = opponents, 200.. = invited friends
insert into auth.users (id, email, raw_user_meta_data)
select public._uid(k), k || '@x', jsonb_build_object('username', 'p' || k)
  from (select unnest(array[1, 2, 3, 4, 5, 9]) k union all select generate_series(100, 160) union all select generate_series(200, 202)) t;
insert into public.admin_roles (user_id, role) values (public._uid(9), 'admin') on conflict do nothing;
-- the season starts today (the default is 22 Nov; the test works on any day)
update public.pass_settings set season_start = (now() at time zone 'Asia/Tashkent')::date;

-- D today (minutes ago, all inside today in Tashkent unless the test runs right after midnight):
--  4 rated games vs E (3 wins, then a loss): only 3 count (same opponent) → 3 × 15 + 3 × 25
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at)
select public._uid(1), public._uid(2), 'finished', true, case when i < 4 then 'white' else 'black' end, 30,
       now() - make_interval(mins => 90 - i * 5), now() - make_interval(mins => 89 - i * 5)
  from generate_series(1, 4) i;
--  a loss vs F (D is black) → 15; a win vs G → 40; a short game vs G → ignored
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at) values
 (public._uid(3), public._uid(1), 'finished', true, 'white', 30, now() - interval '70 min', now() - interval '69 min'),
 (public._uid(1), public._uid(4), 'finished', true, 'white', 30, now() - interval '68 min', now() - interval '67 min'),
 (public._uid(1), public._uid(4), 'finished', true, 'white', 4,  now() - interval '66 min', now() - interval '65 min');
--  12 practice-bot wins: 12 × 5 + 10 × 10
insert into public.matches (white_id, black_id, status, rated, result, move_count, vs_bot, bot_level, started_at, ended_at)
select public._uid(1), null, 'finished', false, 'white', 30, true, 'easy', now() - make_interval(mins => 140 - i), now() - make_interval(mins => 139 - i)
  from generate_series(1, 12) i;
--  3 daily missions + the bonus → 3 × 20 + 40; a one-time mission does not count
insert into public.mission_claims (user_id, mission, period, reward) values
 (public._uid(1), 'd_wins3', public._pass_day()::text, 30), (public._uid(1), 'd_games5', public._pass_day()::text, 30),
 (public._uid(1), 'd_invite', public._pass_day()::text, 50), (public._uid(1), 'd_bonus', public._pass_day()::text, 60),
 (public._uid(1), 'o_games10', 'once', 50);
--  3 invited friends today → 2 × 100
insert into public.referrals (inviter_id, invitee_id, code, created_at)
select public._uid(1), public._uid(200 + i), 'TESTCODE', now() - make_interval(mins => 30 - i) from generate_series(0, 2) i;

set role authenticated;
select set_config('request.jwt.claim.sub', public._uid(1)::text, false);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- 120 (E) + 15 (F) + 40 (G) + 160 (bot) + 50 (first win) + 100 (missions) + 200 (friends) = 685
select public._p_check('xp = 685', (public.pass_me()->>'xp')::int = 685, public.pass_me()->>'xp');
select public._p_check('today = 685', (public.pass_me()->'today'->>'today')::int = 685, public.pass_me()->'today'->>'today');
select public._p_check('check-in ok', (public.pass_checkin()->>'ok')::boolean);
select public._p_check('second check-in refused', not (public.pass_checkin()->>'ok')::boolean);
select public._p_check('xp after check-in = 710 (level 6)', (public.pass_me()->>'xp')::int = 710 and public._pass_level(710) = 6, public.pass_me()->>'xp');
select public._p_check('price 50 / 55 Stars', (public.pass_me()->'price'->>'stars')::int = 50 and (public.pass_me()->'price'->>'starsBefore')::int = 55);
select public._p_check('40 rewards', json_array_length(public.pass_me()->'rewards') = 40);

select public._p_check('claim free 1 (50 coins)', (public.pass_claim(1, 'free')->>'coins')::int = 50);
select public._p_check('free 1 again refused', public.pass_claim(1, 'free')->>'error' = 'already');
select public._p_check('free 2 piece set to the inventory', public.pass_claim(2, 'free')->>'item' = 'pass-stone-classic');
select public._p_check('free 3 booster kept', (public.pass_claim(3, 'free')->>'ok')::boolean);
select public._p_check('free 4 frame', public.pass_claim(4, 'free')->>'cosmetic' = 'frame');
select public._p_check('free 6 emoji', (public.pass_claim(6, 'free')->>'ok')::boolean);
select public._p_check('free 7 locked (level 6)', public.pass_claim(7, 'free')->>'error' = 'locked');
select public._p_check('elite 1 needs Premium', public.pass_claim(1, 'elite')->>'error' = 'elite');
do $$ begin perform public.pass_grant_premium(public._uid(1), 'self'); raise exception 'should fail'; exception when others then
  perform public._p_check('player cannot call pass_grant_premium', sqlerrm <> 'should fail', sqlerrm); end $$;
select public._p_check('stored booster listed', json_array_length(public.pass_boosters()->'stored') = 1);
select public._p_check('worn: frame + emoji', public.pass_me()->'equipped'->>'frame' = 'f-laurel' and public.pass_me()->'equipped'->>'emoji' = 'em-cool',
                       (public.pass_me()->'equipped')::text);

-- the admin gives D Premium (paid in so'm)
select set_config('request.jwt.claim.sub', public._uid(9)::text, false);
select public._p_check('admin gives Premium', (public.pass_grant_premium(public._uid(1), 'paid 11900 som')->>'ok')::boolean);
select public._p_check('second grant: already', (public.pass_grant_premium(public._uid(1), null)->>'already')::boolean);
select set_config('request.jwt.claim.sub', public._uid(1)::text, false);
select public._p_check('elite now', (public.pass_me()->>'elite')::boolean);
select public._p_check('elite 1 = 300 coins', (public.pass_claim(1, 'elite')->>'coins')::int = 300);
select public._p_check('elite 2 Royal Stone', public.pass_claim(2, 'elite')->>'item' = 'pass-stone-royal');
select public._p_check('elite 3 booster kept', (public.pass_claim(3, 'elite')->>'ok')::boolean);
select public._p_check('elite 6 Golden Wings frame', (public.pass_claim(6, 'elite')->>'ok')::boolean);
select public._p_check('two stored boosters', json_array_length(public.pass_boosters()->'stored') = 2);

-- turn the +30% one on; the other cannot run at the same time
select public._p_check('use +30% booster',
  (public.pass_booster_use((select (e->>'id')::bigint from json_array_elements(public.pass_boosters()->'stored') e where (e->>'pct')::int = 30))->>'ok')::boolean);
select public._p_check('second booster refused while one runs',
  public.pass_booster_use((select (e->>'id')::bigint from json_array_elements(public.pass_boosters()->'stored') e where (e->>'pct')::int = 10))->>'error' = 'active');
select public._p_check('boost now 30', (public.pass_me()->>'boost_today')::int = 30);
reset role;
-- a loss vs H while the booster runs: 15 + 30% = 19
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at)
values (public._uid(1), public._uid(5), 'finished', true, 'black', 30, now(), now() + interval '2 s');
set role authenticated;
select public._p_check('boosted game = +19 → 729', (public.pass_me()->>'xp')::int = 729, public.pass_me()->>'xp');

-- many wins vs different opponents: wins count with no daily limit
reset role;
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at)
select public._uid(1), public._uid(100 + i), 'finished', true, 'white', 30, now() - make_interval(mins => 50 - i), now() - make_interval(mins => 49 - i)
  from generate_series(0, 39) i;
-- XP follows the time order: these 40 wins ended before H's game, so the day's first 20 live games are now E×3, F, G and
-- 15 of these wins; H's loss (the 46th game) gives nothing any more. Live: 20 × 15 + 44 wins × 25 = 1400 (was 194) → 1935
set role authenticated;
select public._p_check('40 more wins → 1935', (public.pass_me()->>'xp')::int = 1935, public.pass_me()->>'xp');
select public._p_check('level 10', public._pass_level((public.pass_me()->>'xp')::int) = 10);
-- losses after the first 20 live games give nothing
reset role;
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at)
select public._uid(1), public._uid(150 + i), 'finished', true, 'black', 30, now() - make_interval(mins => 10 - i), now() - make_interval(mins => 9 - i)
  from generate_series(0, 4) i;
set role authenticated;
select public._p_check('losses after 20 games: +0', (public.pass_me()->>'xp')::int = 1935, public.pass_me()->>'xp');

select public._p_check('elite 10 chest gives a game item',
  (select r->>'item' in ('fx-sparkle', 'st-sapphire', 'royal-wood') from (select public.pass_claim(10, 'elite') r) q));
select public._p_check('chest item is in the inventory',
  exists (select 1 from public.user_inventory where user_id = public._uid(1) and item_slug in ('fx-sparkle', 'st-sapphire', 'royal-wood')));
select public._p_check('elite 7 Royal Crown Board', public.pass_claim(7, 'elite')->>'item' = 'pass-royal-gold');
select public._p_check('elite 8 Royal Lightning', public.pass_claim(8, 'elite')->>'item' = 'fx-royal-lightning');
select public._p_check('elite 11 locked (level 10)', public.pass_claim(11, 'elite')->>'error' = 'locked');
select public._p_check('coins: 50 + 300 = 350 on the wallet',
  (select balance from public.user_wallets where user_id = public._uid(1)) >= 350, (select balance::text from public.user_wallets where user_id = public._uid(1)));
select public._p_check('equip the Royal Stone (owned)', (public.equip_item('piece', 'pass-stone-royal')->>'ok')::boolean);
select public._p_check('worn readable by anyone', public.pass_worn(public._uid(1))->>'frame' = 'f-laurel');
select public._p_check('equip a frame not owned refused', not (public.pass_equip('frame', 'f-crown-wings')->>'ok')::boolean);
select public._p_check('equip Golden Wings', (public.pass_equip('frame', 'f-gold-wings')->>'ok')::boolean);

-- combo + victory (give level 13 straight: more wins today)
reset role;
insert into public.matches (white_id, black_id, status, rated, result, move_count, started_at, ended_at)
select public._uid(1), public._uid(100 + i), 'finished', true, 'white', 30, now() - make_interval(mins => 200 - i), now() - make_interval(mins => 199 - i)
  from generate_series(0, 44) i;     -- the same opponents again (each may count up to 3 times a day): 45 × 25 → 3060, level 13
set role authenticated;
select public._p_check('45 more wins → 3060', (public.pass_me()->>'xp')::int = 3060, public.pass_me()->>'xp');
select public._p_check('elite 11 throne background', (public.pass_claim(11, 'elite')->>'ok')::boolean);
select public._p_check('elite 12 combo', public.pass_claim(12, 'elite')->>'cosmetic' = 'combo', public.pass_me()->>'xp');
select public._p_check('elite 13 victory', public.pass_claim(13, 'elite')->>'cosmetic' = 'victory');
select public._p_check('worn: combo + victory', public.pass_me()->'equipped'->>'combo' = 'cb-double' and public.pass_me()->'equipped'->>'victory' = 'v-royal');
select public._p_check('combo cannot be "equipped"', not (public.pass_equip('combo', 'cb-double')->>'ok')::boolean);

-- Premium with Stars (service role, as the payments Edge Function / bot do)
reset role;
select set_config('request.jwt.claim.sub', '', false);
create temp table _o as select public.pass_order_create(public._uid(2)) o;
select public._p_check('order: 50 Stars', ((select o from _o)->>'stars')::int = 50);
select public._p_check('precheck: wrong amount refused',
  public.pass_payment_precheck(((select o from _o)->>'order_id')::uuid, 49, 'XTR', null) = 'amount mismatch');
select public._p_check('precheck ok',
  public.pass_payment_precheck(((select o from _o)->>'order_id')::uuid, 50, 'XTR', null) is null);
select public._p_check('payment completes',
  (public.pass_payment_complete(((select o from _o)->>'order_id')::uuid, 'charge-1', 'prov-1', 50, null, '{}')->>'ok')::boolean);
select public._p_check('same payment again: duplicate',
  (public.pass_payment_complete(((select o from _o)->>'order_id')::uuid, 'charge-1', 'prov-1', 50, null, '{}')->>'duplicate')::boolean);
select public._p_check('E is Premium', exists (select 1 from public.pass_elite where user_id = public._uid(2) and method = 'stars'));
do $$ begin perform public.pass_order_create(public._uid(2)); raise exception 'should fail'; exception when others then
  perform public._p_check('no second order after Premium', sqlerrm = 'already premium', sqlerrm); end $$;

-- the anonymous role cannot read the tables
set role anon;
do $$ begin perform 1 from public.pass_claims limit 1; perform public._p_check('anon cannot read claims', false); exception when others then
  perform public._p_check('anon cannot read claims', true); end $$;
reset role;

select name, ok, detail from public._p_results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from public._p_results;
