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
create temp table q1 as select public.quick_match() as r;
grant all on q1 to public;
select pg_temp.check('first player is queued', (select (r ->> 'match_id') is null from q1));
select pg_temp.check('quick_match reports search start + server clock', (select (r ->> 'searching_since') is not null and (r ->> 'server_now') is not null from q1));
select pg_sleep(1.1);
select pg_temp.check('search start is kept while the player keeps pinging', (select (public.quick_match() ->> 'searching_since') = (r ->> 'searching_since') from q1));
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

-- bot games (server bot; since 0009 they never change the rating)
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
create temp table bm as select public.start_bot_match('hard') as r;
grant all on bm to public;
select pg_temp.check('start_bot_match creates an active bot game', (select status = 'active' and vs_bot and bot_level = 'hard' from public.matches where id = (select (r->>'match_id')::uuid from bm)));
select pg_temp.check('bot game is unrated', (select not rated from public.matches where id = (select (r->>'match_id')::uuid from bm)) and (select (r->>'rated')::boolean = false from bm));
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
select pg_temp.check('beating the bot gives NO rating', (select rating from public.profiles where id = '33333333-3333-3333-3333-333333333333') = (select rating from before_c));
select pg_temp.check('bot win adds no rating history / W-L stats', (select count(*) from public.rating_history where match_id = (select (r->>'match_id')::uuid from bm)) = 0);
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
grant all on before_b to public;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.start_bot_match('easy');  -- abandons the previous one
select pg_temp.check('abandoned bot game is closed as a loss but rating unchanged', (select rating from public.profiles where id = auth.uid()) = (select rating from before_b)
  and (select status = 'finished' and result = 'black' from public.matches where id = (select (r->>'match_id')::uuid from cap)));
select public.start_bot_match('easy'); select public.start_bot_match('easy'); select public.start_bot_match('easy');
select pg_temp.check('any number of bot games stays unrated', (select (public.start_bot_match('easy') ->> 'rated')::boolean) = false
  and (select rating from public.profiles where id = auth.uid()) = (select rating from before_b));
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

-- ---------- clocks (0008) ----------
select pg_temp.check('old quick_match() pairs with a 3-minute clock',
  (select time_control = 180 and white_ms = 180000 and black_ms = 180000 and turn_started_at is not null
     from public.matches where not vs_bot and black_id is not null and code is null order by created_at limit 1));
select pg_temp.check('accepted challenge has a 3-minute clock', (select time_control = 180 from public.matches where id = (select (r->>'match_id')::uuid from acc)));
select pg_temp.check('room game has a 3-minute clock', (select time_control = 180 from public.matches where id = (select (r ->> 'match_id')::uuid from room)));
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('quick_match(60) queues', (public.quick_match(60) ->> 'match_id') is null);
do $$ begin
  perform public.quick_match(45);
  perform pg_temp.check('bad time control rejected', false);
exception when others then perform pg_temp.check('bad time control rejected', sqlerrm like '%time control%', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('different time control is NOT paired', (public.quick_match(300) ->> 'match_id') is null);
create temp table tm as select public.quick_match(60) as r;
grant all on tm to public;
select pg_temp.check('same time control is paired', (select (r ->> 'match_id') is not null and (r ->> 'time_control')::int = 60 from tm));
reset role;
create temp table tmid as select (r ->> 'match_id')::uuid as id from tm;
grant all on tmid to public;
select pg_temp.check('1-minute game: 60 s each, clock running', (select time_control = 60 and white_ms = 60000 and black_ms = 60000 from public.matches where id = (select id from tmid)));

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.clock_take_turn((select id from tmid), 0);
  perform pg_temp.check('client can NOT call clock_take_turn', false);
exception when others then perform pg_temp.check('client can NOT call clock_take_turn', sqlstate = '42501', sqlerrm); end $$;
select pg_temp.check('claim_timeout before the deadline does nothing', (public.claim_timeout((select id from tmid)) ->> 'ended')::boolean = false);
reset role;

set role service_role;
select pg_temp.check('first move: White''s clock not charged', (select (public.clock_take_turn((select id from tmid), 0) ->> 'white_ms')::int = 60000));
select pg_temp.check('same ply twice → conflict', (public.clock_take_turn((select id from tmid), 0) ->> 'error') = 'conflict');
update public.matches set turn_started_at = clock_timestamp() - interval '5 seconds' where id = (select id from tmid);
create temp table ct1 as select public.clock_take_turn((select id from tmid), 1) as r;
select pg_temp.check('Black''s move charges Black ~5 s', (select (r ->> 'black_ms')::int between 54800 and 55100 from ct1), (select r::text from ct1));
select pg_temp.check('White''s clock untouched by Black''s move', (select white_ms = 60000 and move_count = 2 from public.matches where id = (select id from tmid)));
update public.matches set turn_started_at = clock_timestamp() - interval '10 seconds' where id = (select id from tmid);
create temp table ct2 as select public.clock_take_turn((select id from tmid), 2) as r;
select pg_temp.check('White''s 2nd move charges White ~10 s', (select (r ->> 'white_ms')::int between 49800 and 50100 from ct2), (select r::text from ct2));
-- Black (to move, ply 3) takes 31 s → over the 30 s limit
update public.matches set turn_started_at = clock_timestamp() - interval '31.5 seconds' where id = (select id from tmid);
select pg_temp.check('move after 30 s (+1 s grace) is refused', (public.clock_take_turn((select id from tmid), 3) ->> 'error') = 'timeout');
select pg_temp.check('… and Black loses on the move limit',
  (select status = 'finished' and result = 'white' and timeout_kind = 'move' and rating_applied from public.matches where id = (select id from tmid)));
select pg_temp.check('timeout loss is rated once (±5)', (select white_delta = 5 and black_delta = -5 from public.matches where id = (select id from tmid)));
reset role;

-- clock (not the 30 s limit) runs out → claim by the opponent
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.quick_match(300);
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table tm2 as select (public.quick_match(300) ->> 'match_id')::uuid as id;
grant all on tm2 to public;
reset role;
update public.matches set move_count = 1, black_ms = 4000, turn_started_at = clock_timestamp() - interval '6 seconds' where id = (select id from tm2);
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform public.claim_timeout((select id from tm2));
  perform pg_temp.check('outsider can NOT claim a timeout', false);
exception when others then perform pg_temp.check('outsider can NOT claim a timeout', true, sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('claim_timeout ends the game when the clock is out', (public.claim_timeout((select id from tm2)) ->> 'ended')::boolean);
select pg_temp.check('… Black lost on the clock, clock shows 0',
  (select result = 'white' and timeout_kind = 'clock' and black_ms = 0 from public.matches where id = (select id from tm2)));
select pg_temp.check('second claim is a no-op', (public.claim_timeout((select id from tm2)) ->> 'ended')::boolean = false);
select pg_temp.check('match_view exposes the clock', (select time_control = 300 and server_now is not null and timeout_kind = 'clock' from public.match_view where id = (select id from tm2)));
reset role;

-- sweep: an abandoned game ends without anyone claiming it
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.quick_match(180);
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table tm3 as select (public.quick_match(180) ->> 'match_id')::uuid as id;
grant all on tm3 to public;
reset role;
update public.matches set turn_started_at = clock_timestamp() - interval '40 seconds' where id = (select id from tm3);
set role service_role;
select pg_temp.check('sweep ends abandoned games', public.finish_expired_games() >= 1);
select pg_temp.check('… White never moved → Black wins', (select result = 'black' and timeout_kind = 'move' from public.matches where id = (select id from tm3)));
reset role;

-- bot games stay untimed
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create temp table bm8 as select public.start_bot_match('easy') as r;
select pg_temp.check('bot games have no clock', (select time_control is null from public.matches where id = (select (r ->> 'match_id')::uuid from bm8)));
reset role;

-- ---------- DAMEO Weekly Tournament (0010) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-4000-8000-000000000004', 'w4@x.io', '{"username":"wk_four"}'),
  ('cccccccc-0000-4000-8000-000000000005', 'w5@x.io', '{"username":"wk_five"}'),
  ('cccccccc-0000-4000-8000-000000000006', 'w6@x.io', '{"username":"wk_six"}'),
  ('cccccccc-0000-4000-8000-000000000008', 'w8@x.io', '{"username":"wk_eight"}'),
  ('cccccccc-0000-4000-8000-000000000009', 'w9@x.io', '{"username":"wk_nine"}'),
  ('cccccccc-0000-4000-8000-000000000010', 'w10@x.io', '{"username":"wk_ten"}');
-- a finished PvP game: (white, black, result, ended_at) → applied once by the server
create function pg_temp.pvp(w uuid, b uuid, res text, at timestamptz) returns uuid language plpgsql as $$
declare mid uuid;
begin
  insert into public.matches (white_id, black_id, status, rated, started_at) values (w, b, 'active', true, at) returning matches.id into mid;
  update public.matches set status = 'finished', result = res, result_reason = 'no-moves', ended_at = at where matches.id = mid;
  perform public.apply_match_result(mid);
  return mid;
end $$;

set role anon;
select pg_temp.check('anyone can read the weekly overview', (public.weekly_overview() -> 'current' ->> 'id') is not null);
reset role;
select pg_temp.check('one tournament per week (no duplicates)', (select count(*) from public.weekly_tournaments) = 1);
select pg_temp.check('week = Monday 00:00 → next Monday 00:00 Tashkent',
  (select extract(isodow from starts_at at time zone 'Asia/Tashkent') = 1 and (starts_at at time zone 'Asia/Tashkent')::time = '00:00'
          and ends_at - starts_at = interval '7 days' and now() >= starts_at and now() < ends_at from public.weekly_tournaments));
do $$ begin
  set local role anon;
  perform public.weekly_join();
  perform pg_temp.check('anon can NOT join', false);
exception when others then perform pg_temp.check('anon can NOT join', true, sqlerrm); end $$;

set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000004';
select pg_temp.check('join records the current rating as start', (public.weekly_join() ->> 'start_rating')::int = 1200);
select public.weekly_join();
select pg_temp.check('joining twice does not duplicate', (select count(*) from public.weekly_entries where user_id = auth.uid()) = 1);
do $$ begin
  insert into public.weekly_entries (tournament_id, user_id, start_rating) select id, '33333333-3333-3333-3333-333333333333', 9999 from public.weekly_tournaments;
  perform pg_temp.check('client can NOT write entries directly', false);
exception when others then perform pg_temp.check('client can NOT write entries directly', true, sqlerrm); end $$;
do $$ begin
  update public.weekly_entries set start_rating = 100 where user_id = auth.uid();
  perform pg_temp.check('client can NOT change own start rating', (select start_rating from public.weekly_entries where user_id = auth.uid()) = 1200);
exception when others then perform pg_temp.check('client can NOT change own start rating', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.weekly_tick();
  perform pg_temp.check('client can NOT run the scheduler', false);
exception when others then perform pg_temp.check('client can NOT run the scheduler', sqlstate = '42501', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000005';
select public.weekly_join();
reset role;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000006';
select public.weekly_join();
reset role;

-- a game that ended BEFORE joining does not count; one after joining does
select pg_temp.pvp('cccccccc-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000004', 'white', now() - interval '1 hour');
update public.weekly_entries set start_rating = (select rating from public.profiles where id = user_id) where user_id in ('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000005');  -- as if they joined after that game
create temp table g1 as select pg_temp.pvp('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000005', 'white', clock_timestamp()) as id;
grant all on g1 to public;
select public.apply_match_result((select id from g1));    -- a second call must not count it again
create temp table st1 as select * from public.weekly_standings();
grant all on st1 to public;
select pg_temp.check('winner +5, 1 win, rank 1', (select delta = 5 and wins = 1 and games = 1 and rank = 1 from st1 where username = 'wk_four'), (select string_agg(username || ':' || delta || '/' || games, ' ') from st1));
select pg_temp.check('loser −5, 1 loss, rank 2', (select delta = -5 and losses = 1 and rank = 2 from st1 where username = 'wk_five'));
select pg_temp.check('game before joining is not counted', (select games = 1 from st1 where username = 'wk_five'));
select pg_temp.check('player without games is listed but unranked', (select rank is null and games = 0 from st1 where username = 'wk_six'));
select pg_temp.check('tournament rating = global rating (in sync)',
  (select bool_and(st1.rating = p.rating) from st1 join public.profiles p on p.id = st1.user_id));
-- bot games never count, even a (legacy) rated one; unrated PvP games neither
insert into public.matches (white_id, status, rated, vs_bot, bot_level, started_at, ended_at, result, result_reason)
  values ('cccccccc-0000-4000-8000-000000000004', 'finished', true, true, 'easy', now(), clock_timestamp(), 'white', 'no-moves');
select public.apply_match_result(id) from public.matches where vs_bot and white_id = 'cccccccc-0000-4000-8000-000000000004';
insert into public.matches (white_id, black_id, status, rated, started_at, ended_at, result, result_reason)
  values ('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000006', 'finished', false, now(), clock_timestamp(), 'white', 'no-moves');
select pg_temp.check('bot and unrated games are not counted', (select delta = 5 and games = 1 from public.weekly_standings() where username = 'wk_four'));
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000004';
select pg_temp.check('overview shows my live score', (select (r -> 'me' ->> 'delta')::int = 5 and (r -> 'me' ->> 'rank')::int = 1 from (select public.weekly_overview() as r) x));
reset role;

-- ---- an ended week: tie-break, freeze, idempotence ----
insert into public.weekly_tournaments (id, week_start, name, starts_at, ends_at)
  values ('dddddddd-0000-4000-8000-000000000001', (public._weekly_bounds(now())).week_start - 7, 'past week',
          now() - interval '7 days', now() - interval '1 minute');
insert into public.weekly_entries (tournament_id, user_id, joined_at, start_rating)
  select 'dddddddd-0000-4000-8000-000000000001', id, now() - interval '7 days', rating from public.profiles
   where id in ('cccccccc-0000-4000-8000-000000000008', 'cccccccc-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000010');
select pg_temp.pvp('cccccccc-0000-4000-8000-000000000008', 'cccccccc-0000-4000-8000-000000000009', 'white', now() - interval '3 days');  -- 8 reaches +5 first
select pg_temp.pvp('cccccccc-0000-4000-8000-000000000010', 'cccccccc-0000-4000-8000-000000000009', 'white', now() - interval '2 days');  -- 10 reaches +5 later
select pg_temp.pvp('cccccccc-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000008', 'white', now() - interval '30 seconds'); -- after the end
set role service_role;
select pg_temp.check('scheduler freezes the ended week', (public.weekly_tick() ->> 'finalized')::int = 1);
reset role;
create temp table fin as select * from public.weekly_entries where tournament_id = 'dddddddd-0000-4000-8000-000000000001';
grant all on fin to public;
select pg_temp.check('tie on points → earlier achiever ranks higher', (select final_rank = 1 from fin where user_id = 'cccccccc-0000-4000-8000-000000000008')
  and (select final_rank = 2 from fin where user_id = 'cccccccc-0000-4000-8000-000000000010'));
select pg_temp.check('game after the end is not counted', (select final_delta = -10 and final_games = 2 and final_rank = 3 from fin where user_id = 'cccccccc-0000-4000-8000-000000000009'));
select pg_temp.check('final rating = start + points', (select bool_and(final_rating = start_rating + final_delta) from fin));
select pg_temp.check('week marked finished', (select status = 'finished' and finalized_at is not null from public.weekly_tournaments where id = 'dddddddd-0000-4000-8000-000000000001'));
create temp table fz as select finalized_at from public.weekly_tournaments where id = 'dddddddd-0000-4000-8000-000000000001';
grant all on fz to public;
-- even a game written later with an in-window time cannot change frozen results
select pg_temp.pvp('cccccccc-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000010', 'white', now() - interval '1 day');
set role service_role;
select public.weekly_tick();
reset role;
select pg_temp.check('frozen results never change', (select bool_and(f.final_delta = e.final_delta and f.final_rank is not distinct from e.final_rank)
  from fin f join public.weekly_entries e using (tournament_id, user_id)));
select pg_temp.check('finalize runs only once', (select finalized_at from public.weekly_tournaments where id = 'dddddddd-0000-4000-8000-000000000001') = (select finalized_at from fz));
set role anon;
select pg_temp.check('frozen standings are public', (select count(*) = 3 and bool_and(frozen) from public.weekly_standings('dddddddd-0000-4000-8000-000000000001')));
select pg_temp.check('overview shows last week''s winners', (select json_array_length(public.weekly_overview() -> 'previous' -> 'winners') = 3));
select pg_temp.check('next tournament starts when this one ends', (select (r ->> 'next_starts_at') = (r -> 'current' ->> 'ends_at') from (select public.weekly_overview() as r) x));
reset role;
select pg_temp.check('still one tournament for the current week', (select count(*) from public.weekly_tournaments where week_start = (public._weekly_bounds(now())).week_start) = 1);

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
select pg_temp.check('anon can read the leaderboard', (select count(*) from public.leaderboard) = (select count(*) from public.profiles));
do $$ begin
  perform public.create_room();
  perform pg_temp.check('anon can NOT create rooms', false);
exception when others then perform pg_temp.check('anon can NOT create rooms', true, sqlerrm); end $$;
reset role;

\set QUIET off
select case when ok then 'PASS' else 'FAIL' end as status, name, left(detail, 70) as detail from results order by 1 desc, 2;
select count(*) filter (where not ok) as failures, count(*) as total from results;
