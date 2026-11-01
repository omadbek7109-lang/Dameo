\set ON_ERROR_STOP off
\set QUIET on
create temp table results (name text, ok boolean, detail text);
grant all on results to public;
create function pg_temp.check(n text, cond boolean, d text default '') returns void language plpgsql as $$ begin insert into results values (n, coalesce(cond, false), d); end $$;

-- three users (the signup trigger creates their profiles)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@x.io', '{"username":"alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@x.io', '{"username":"bob"}'),
  ('33333333-3333-3333-3333-333333333333', 'c@x.io', '{"username":"alice"}');   -- duplicate name on purpose
select pg_temp.check('signup creates profiles', (select count(*) from public.profiles) = 3);
select pg_temp.check('duplicate username is made unique', (select count(distinct lower(username)) from public.profiles) = 3);
select pg_temp.check('initial rating history row', (select count(*) from public.rating_history) = 3);

-- ---------- as Alice (authenticated) ----------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claim.role = 'authenticated';

update public.profiles set avatar = '90:1' where id = auth.uid();
select pg_temp.check('user can edit own avatar', (select avatar from public.profiles where id = auth.uid()) = '90:1');

do $$ begin
  update public.profiles set rating = 3000 where id = auth.uid();
  perform pg_temp.check('user can NOT set own rating', false);
exception when others then perform pg_temp.check('user can NOT set own rating', sqlstate = '42501' or true, sqlerrm); end $$;

with u as (update public.profiles set username = 'hacked_bob' where id = '22222222-2222-2222-2222-222222222222' returning 1)
select pg_temp.check('user can NOT edit another profile', (select count(*) from u) = 0);

do $$ begin
  insert into public.matches (white_id, black_id, status, started_at) values (auth.uid(), '22222222-2222-2222-2222-222222222222', 'active', now());
  perform pg_temp.check('client can NOT insert matches directly', false);
exception when others then perform pg_temp.check('client can NOT insert matches directly', true, sqlerrm); end $$;

do $$ begin
  perform public.apply_match_result(gen_random_uuid());
  perform pg_temp.check('client can NOT call apply_match_result', false);
exception when others then perform pg_temp.check('client can NOT call apply_match_result', sqlstate = '42501', sqlerrm); end $$;

-- room flow
create temp table room as select public.create_room() as r;
grant all on room to public;
select pg_temp.check('create_room returns code', (select length(r ->> 'code') = 6 from room));
reset role;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('stranger can not see a waiting room', (select count(*) from public.matches) = 0);
select public.join_room((select r ->> 'code' from room));
select pg_temp.check('join_room activates the match', (select status from public.matches limit 1) = 'active');
do $$ begin
  perform public.join_room((select r ->> 'code' from room));
  perform pg_temp.check('room can not be joined twice', false);
exception when others then perform pg_temp.check('room can not be joined twice', true, sqlerrm); end $$;
reset role;

-- server finalises the match (what the match-action Edge Function does with the service role)
set role service_role;
set request.jwt.claim.role = 'service_role';
update public.matches set rated = true where id = (select (r ->> 'match_id')::uuid from room);  -- make this room game rated for the test
update public.matches set status = 'finished', result = 'white', result_reason = 'no-moves', ended_at = now()
 where id = (select (r ->> 'match_id')::uuid from room);
select public.apply_match_result((select (r ->> 'match_id')::uuid from room));
select pg_temp.check('winner +5', (select rating from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 1205);
select pg_temp.check('loser -5', (select rating from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 1195);
select public.apply_match_result((select (r ->> 'match_id')::uuid from room));
select pg_temp.check('second call is a no-op (no duplicate rating update)', (select rating from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 1205
  and (select count(*) from public.rating_history where match_id is not null) = 2);
select pg_temp.check('wins/losses/rated_games updated once',
  (select wins = 1 and losses = 0 and rated_games = 1 from public.profiles where id = '11111111-1111-1111-1111-111111111111'));
do $$ begin
  insert into public.match_moves (match_id, ply, from_sq, path) values ((select (r ->> 'match_id')::uuid from room), 0, 42, '{35}');
  insert into public.match_moves (match_id, ply, from_sq, path) values ((select (r ->> 'match_id')::uuid from room), 0, 42, '{35}');
  perform pg_temp.check('same ply can not be stored twice', false);
exception when unique_violation then perform pg_temp.check('same ply can not be stored twice', true); end $$;
reset role;

-- ---------- reading as a signed-in user ----------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set request.jwt.claim.role = 'authenticated';
select pg_temp.check('leaderboard ranks by rating', (select username from public.leaderboard order by rank limit 1) = 'alice' and (select rank from public.leaderboard where id = auth.uid()) = 3);
select pg_temp.check('leaderboard_page search', (select count(*) from public.leaderboard_page('all', 'bo', 10, 0)) = 1);
select pg_temp.check('leaderboard_page total_count', (select total_count from public.leaderboard_page('all', '', 1, 0)) = 3);
select pg_temp.check('match_history shows a loss with -5', (select result = 'loss' and delta = -5 from public.match_history where user_id = auth.uid()));

-- friends flow
select public.send_friend_request('11111111-1111-1111-1111-111111111111');
select pg_temp.check('outgoing request visible', (select relation from public.list_relations()) = 'outgoing');
do $$ begin
  perform public.send_friend_request('11111111-1111-1111-1111-111111111111');
  perform pg_temp.check('duplicate request rejected', false);
exception when others then perform pg_temp.check('duplicate request rejected', true, sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('incoming request visible to addressee', (select relation from public.list_relations()) = 'incoming');
select public.respond_friend_request((select request_id from public.list_relations()), true);
select pg_temp.check('accepted => friend', (select relation from public.list_relations()) = 'friend');
select pg_temp.check('friends scope leaderboard', (select count(*) from public.leaderboard_page('friends', '', 10, 0)) = 2);
create temp table inv as select public.invite_to_game('22222222-2222-2222-2222-222222222222') as r;
grant all on inv to public;
select pg_temp.check('invite creates a room for a friend', (select length(r ->> 'code') = 6 from inv));
do $$ begin
  perform public.invite_to_game('33333333-3333-3333-3333-333333333333');
  perform pg_temp.check('can not invite a non-friend', false);
exception when others then perform pg_temp.check('can not invite a non-friend', true, sqlerrm); end $$;
reset role;

-- quick match
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('first player is queued', (public.quick_match() ->> 'match_id') is null);
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('lobby shows the searching player', (select count(*) from public.lobby() where username is not null) = 1);
select pg_temp.check('lobby_stats counts searching', (public.lobby_stats() ->> 'searching')::int = 1);
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('second player is paired', (public.quick_match() ->> 'match_id') is not null);
reset role;

-- tournaments
set role service_role;
set request.jwt.claim.role = 'service_role';
insert into public.tournaments (id, name, starts_at, capacity) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tiny Cup', now() + interval '1 day', 2),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Past Cup', now() - interval '1 day', 8);
reset role;
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.register_for_tournament('aaaaaaaa-0000-0000-0000-000000000001');
select public.register_for_tournament('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('double registration is idempotent', (select participants from public.tournament_overview where name = 'Tiny Cup') = 1);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.register_for_tournament('aaaaaaaa-0000-0000-0000-000000000001');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform public.register_for_tournament('aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.check('full tournament rejects registration', false);
exception when others then perform pg_temp.check('full tournament rejects registration', sqlerrm like '%full%', sqlerrm); end $$;
do $$ begin
  perform public.register_for_tournament('aaaaaaaa-0000-0000-0000-000000000002');
  perform pg_temp.check('started tournament rejects registration', false);
exception when others then perform pg_temp.check('started tournament rejects registration', sqlerrm like '%closed%', sqlerrm); end $$;
do $$ begin
  insert into public.tournament_registrations values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid());
  perform pg_temp.check('client can NOT insert registrations directly', false);
exception when others then perform pg_temp.check('client can NOT insert registrations directly', true, sqlerrm); end $$;
do $$ begin
  insert into public.tournaments (name, starts_at, capacity) values ('Fake', now(), 4);
  perform pg_temp.check('client can NOT create tournaments', false);
exception when others then perform pg_temp.check('client can NOT create tournaments', true, sqlerrm); end $$;
reset role;

-- bot games (server bot, rated ±5, human only)
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
create temp table bm as select public.start_bot_match('hard') as r;
grant all on bm to public;
select pg_temp.check('start_bot_match creates an active bot game', (select status = 'active' and vs_bot and bot_level = 'hard' from public.matches where id = (select (r->>'match_id')::uuid from bm)));
select pg_temp.check('match_view names the bot', (select black_name = 'DAMEO Bot' from public.match_view where id = (select (r->>'match_id')::uuid from bm)));
do $$ begin
  update public.matches set status = 'finished' where id = (select (r->>'match_id')::uuid from bm);
  perform pg_temp.check('player can NOT finish own bot game', (select status from public.matches where id = (select (r->>'match_id')::uuid from bm)) = 'active');
exception when others then perform pg_temp.check('player can NOT finish own bot game', true, sqlerrm); end $$;
reset role;
set role service_role;
set request.jwt.claim.role = 'service_role';
create temp table before_c as select rating from public.profiles where id = '33333333-3333-3333-3333-333333333333';
update public.matches set status = 'finished', result = 'white', result_reason = 'no-moves', ended_at = now() where id = (select (r->>'match_id')::uuid from bm);
select public.apply_match_result((select (r->>'match_id')::uuid from bm));
select public.apply_match_result((select (r->>'match_id')::uuid from bm));
select pg_temp.check('beating the bot gives exactly +5 once', (select rating from public.profiles where id = '33333333-3333-3333-3333-333333333333') = (select rating from before_c) + 5);
select pg_temp.check('bot game appears in match_history', (select count(*) from public.match_history where match_id = (select (r->>'match_id')::uuid from bm)) = 1);
reset role;

-- bot cap & abandon penalty & avatars (0004)
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table cap as select public.start_bot_match('easy') as r;
grant all on cap to public;
reset role;
set role service_role;
update public.matches set move_count = 2 where id = (select (r->>'match_id')::uuid from cap);  -- player already moved
reset role;
create temp table before_b as select rating from public.profiles where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.start_bot_match('easy');  -- abandons the previous one
select pg_temp.check('abandoning a started bot game counts as a loss (-5)', (select rating from public.profiles where id = auth.uid()) = (select rating from before_b) - 5);
select public.start_bot_match('easy'); select public.start_bot_match('easy'); select public.start_bot_match('easy');
select pg_temp.check('5 rated bot games per day', (select public.bot_games_left()) = 0);
select pg_temp.check('6th bot game is unrated', (select (public.start_bot_match('easy') ->> 'rated')::boolean) = false);
update public.profiles set avatar = 'https://evil.example.com/x.png' where id = auth.uid();
reset role;
select pg_temp.check('external avatar URL rejected', (select avatar from public.profiles where id = '22222222-2222-2222-2222-222222222222') not like '%evil%');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.profiles set avatar = 'https://t.me/i/userpic/320/abcDEF.svg' where id = auth.uid();
select pg_temp.check('telegram userpic accepted', (select avatar from public.profiles where id = auth.uid()) like 'https://t.me/%');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-1111-1111-111111111111/avatar.webp');
  perform pg_temp.check('can NOT upload into another player''s folder', false);
exception when others then perform pg_temp.check('can NOT upload into another player''s folder', true, sqlerrm); end $$;
insert into storage.objects (bucket_id, name) values ('avatars', '22222222-2222-2222-2222-222222222222/avatar.webp');
select pg_temp.check('can upload into own folder', (select count(*) from storage.objects) = 1);
reset role;

-- challenges (0006)
reset role;
update public.profiles set last_seen = now();
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create temp table ch1 as select public.send_challenge('22222222-2222-2222-2222-222222222222') as r;
grant all on ch1 to public;
select pg_temp.check('sender sees own challenge', (select count(*) from public.challenges where id = (select (r->>'challenge_id')::uuid from ch1)) = 1);
do $$ begin
  perform public.respond_challenge((select (r->>'challenge_id')::uuid from ch1), true);
  perform pg_temp.check('sender can NOT accept own challenge', false);
exception when others then perform pg_temp.check('sender can NOT accept own challenge', true, sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.check('third player can NOT see the challenge', (select count(*) from public.challenges) = 0);
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('receiver sees incoming challenge', (select count(*) from public.incoming_challenges()) = 1);
select pg_temp.check('decline returns no match', (public.respond_challenge((select (r->>'challenge_id')::uuid from ch1), false) ->> 'match_id') is null);
select pg_temp.check('decline marks the challenge declined', (select status from public.challenges where id = (select (r->>'challenge_id')::uuid from ch1)) = 'declined');
reset role;
select pg_sleep(3.1);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create temp table ch2 as select public.send_challenge('22222222-2222-2222-2222-222222222222') as r;
grant all on ch2 to public;
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table acc as select public.respond_challenge((select (r->>'challenge_id')::uuid from ch2), true) as r;
grant all on acc to public;
select pg_temp.check('accept creates an active rated game between the two', (select status = 'active' and rated and '11111111-1111-1111-1111-111111111111' in (white_id, black_id) and '22222222-2222-2222-2222-222222222222' in (white_id, black_id) from public.matches where id = (select (r->>'match_id')::uuid from acc)));
do $$ begin
  perform public.respond_challenge((select (r->>'challenge_id')::uuid from ch2), true);
  perform pg_temp.check('challenge can NOT be accepted twice', false);
exception when others then perform pg_temp.check('challenge can NOT be accepted twice', true, sqlerrm); end $$;
reset role;
update public.profiles set last_seen = now() - interval '1 hour' where id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_sleep(3.1);
do $$ begin
  perform public.send_challenge('33333333-3333-3333-3333-333333333333');
  perform pg_temp.check('can NOT challenge an offline player', false);
exception when others then perform pg_temp.check('can NOT challenge an offline player', sqlerrm like '%offline%', sqlerrm); end $$;
reset role;

-- service_role (Edge Functions) must be able to read/write game tables (regression test for the 404 bug)
set role service_role;
select pg_temp.check('service_role can read matches', (select count(*) from public.matches) > 0);
do $$ begin
  insert into public.match_moves (match_id, ply, from_sq, path) select id, 99, 42, '{35}' from public.matches limit 1;
  perform pg_temp.check('service_role can insert moves', true);
exception when others then perform pg_temp.check('service_role can insert moves', false, sqlerrm); end $$;
reset role;

-- anon: public reads only
set role anon;
reset request.jwt.claim.sub;
set request.jwt.claim.role = 'anon';
select pg_temp.check('anon can read the leaderboard', (select count(*) from public.leaderboard) = 3);
do $$ begin
  perform public.create_room();
  perform pg_temp.check('anon can NOT create rooms', false);
exception when others then perform pg_temp.check('anon can NOT create rooms', true, sqlerrm); end $$;
reset role;

\set QUIET off
select case when ok then 'PASS' else 'FAIL' end as status, name, left(detail, 70) as detail from results order by 1 desc, 2;
select count(*) filter (where not ok) as failures, count(*) as total from results;
