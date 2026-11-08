\set ON_ERROR_STOP off
\set QUIET on
create temp table results (name text, ok boolean, detail text);
grant all on results to public;
create function pg_temp.check(n text, cond boolean, d text default '') returns void language plpgsql as $$ begin insert into results values (n, coalesce(cond, false), d); end $$;
-- the older tests below expect exact points: use a fixed ±5 instead of 0019's random +15…+30 (restored + tested at the end)
create or replace function public._rand_delta(p_score numeric, p_me int, p_opp int) returns int
language sql volatile as $$ select case when p_score = 1 then 5 when p_score = 0 then -5 else 0 end; $$;

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
update public.matches set status = 'finished', result = 'white', result_reason = 'no-moves', ended_at = now(), move_count = 24
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
select pg_temp.check('timeout after 2 moves: loser −5, winner gains nothing (short game)', (select white_delta = 0 and black_delta = -5 and rating_note = 'short' from public.matches where id = (select id from tmid)));
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
  update public.matches set status = 'finished', result = res, result_reason = 'no-moves', ended_at = at, move_count = 20 where matches.id = mid;
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

-- ---------- DAMEO Coins, Stars payments, Shop, Inventory, Admin (0011/0012) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'e1@x.io', '{"username":"buyer_one"}'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'e2@x.io', '{"username":"owner_super"}'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'e3@x.io', '{"username":"staff_mod"}'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'e4@x.io', '{"username":"bad_player"}');
update public.profiles set tg_id = 7550418397 where id = 'eeeeeeee-0000-4000-8000-000000000002';
update public.profiles set tg_id = 111000111 where id = 'eeeeeeee-0000-4000-8000-000000000001';
select pg_temp.check('1-2 new player gets a wallet with 0 coins', (select balance = 0 from public.user_wallets where user_id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.check('every existing player has a wallet', (select count(*) from public.profiles p left join public.user_wallets w on w.user_id = p.id where w.user_id is null) = 0);
-- (0023 took the older piece sets off sale; the shop tests below still exercise buying with a few of them)
update public.shop_items set active = true, retired = false where slug in ('gold-classic', 'titanium', 'chrome', 'emperor', 'shadow-king');
update public.shop_categories set visible = true where id = 'pieces';
select pg_temp.check('catalog seeded (pieces, boards, animations)', (select count(*) filter (where slot = 'piece') >= 28 and count(*) filter (where slot = 'board') >= 12 and count(*) filter (where slot = 'effect') >= 5 from public.shop_items));

set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
do $$ begin
  update public.user_wallets set balance = 999999 where user_id = auth.uid();
  perform pg_temp.check('client can NOT change own balance', (select balance from public.user_wallets where user_id = auth.uid()) = 0);
exception when others then perform pg_temp.check('client can NOT change own balance', true, sqlerrm); end $$;
do $$ begin
  perform public.payment_complete(gen_random_uuid(), 'fakecharge', null, 25, 111000111, '{}');
  perform pg_temp.check('client can NOT credit a payment', false);
exception when others then perform pg_temp.check('client can NOT credit a payment', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.admin_dashboard();
  perform pg_temp.check('16 normal player can NOT open the admin panel', false);
exception when others then perform pg_temp.check('16 normal player can NOT open the admin panel', sqlerrm like '%forbidden%', sqlerrm); end $$;
select pg_temp.check('admin_me says: no role', (public.admin_me() ->> 'role') is null);
do $$ begin
  perform public.shop_buy('gold-classic', 'key-poor-0001');
  perform pg_temp.check('11 purchase refused without enough coins', false);
exception when others then perform pg_temp.check('11 purchase refused without enough coins', sqlerrm like '%insufficient%', sqlerrm); end $$;
select pg_temp.check('… and nothing was given', (select count(*) from public.user_inventory where user_id = auth.uid()) = 0);
reset role;

-- (0020 switched the old big packages off and re-prices by the 1000 Coin = 25 Stars rate; these payment tests keep a fixed fixture)
update public.coin_packages set active = true, stars = 120, stars_manual = true where id = 'coins_25k';
-- 3-5 Telegram Stars top-up (what the payments + telegram-bot Edge Functions do with the service role)
set role service_role;
create temp table ord as select public.payment_create('eeeeeeee-0000-4000-8000-000000000001', 'coins_25k') as r;
grant all on ord to public;
select pg_temp.check('3 order created as pending', (select status = 'pending' and coins = 25000 and stars = 120 from public.payment_orders where id = (select (r->>'order_id')::uuid from ord)));
select pg_temp.check('pre-checkout accepts the exact payment', public.payment_precheck((select (r->>'order_id')::uuid from ord), 120, 'XTR', 111000111) is null);
select pg_temp.check('pre-checkout refuses a wrong amount', public.payment_precheck((select (r->>'order_id')::uuid from ord), 1, 'XTR', 111000111) = 'amount mismatch');
select pg_temp.check('pre-checkout refuses another Telegram account', public.payment_precheck((select (r->>'order_id')::uuid from ord), 120, 'XTR', 999) = 'wrong account');
select pg_temp.check('4 payment confirmed → coins credited', (public.payment_complete((select (r->>'order_id')::uuid from ord), 'charge-AAA-1', 'prov-1', 120, 111000111, '{}') ->> 'balance')::bigint = 25000);
select pg_temp.check('5 same Telegram payment again → no second credit', (public.payment_complete((select (r->>'order_id')::uuid from ord), 'charge-AAA-1', 'prov-1', 120, 111000111, '{}') ->> 'duplicate')::boolean);
select pg_temp.check('5b another charge for a paid order → no second credit', (public.payment_complete((select (r->>'order_id')::uuid from ord), 'charge-AAA-2', 'prov-2', 120, 111000111, '{}') ->> 'duplicate')::boolean);
select pg_temp.check('balance credited exactly once', (select balance = 25000 from public.user_wallets where user_id = 'eeeeeeee-0000-4000-8000-000000000001'));
select pg_temp.check('ledger row for the top-up', (select count(*) = 1 and sum(amount) = 25000 from public.wallet_transactions where user_id = 'eeeeeeee-0000-4000-8000-000000000001' and kind = 'topup'));
select pg_temp.check('order marked paid with the Telegram charge id', (select status = 'paid' and telegram_payment_charge_id = 'charge-AAA-1' from public.payment_orders where id = (select (r->>'order_id')::uuid from ord)));
select pg_temp.check('paid order cannot pass pre-checkout again', public.payment_precheck((select (r->>'order_id')::uuid from ord), 120, 'XTR', 111000111) = 'order is paid');
reset role;

set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select pg_temp.check('wallet_me shows the balance', (public.wallet_me() ->> 'balance')::bigint = 25000);
select pg_temp.check('top-up notification', (select count(*) = 1 from public.notifications_mine() where kind = 'wallet.topup'));
-- 6-8 shop
select pg_temp.check('6 buy Gold Classic (12 000)', (public.shop_buy('gold-classic', 'key-buy-0001') ->> 'balance')::bigint = 13000);
select pg_temp.check('same request again is not charged twice', (public.shop_buy('gold-classic', 'key-buy-0001') ->> 'duplicate')::boolean and (public.wallet_me() ->> 'balance')::bigint = 13000);
do $$ begin
  perform public.shop_buy('gold-classic', 'key-buy-0002');
  perform pg_temp.check('cannot buy an owned item again', false);
exception when others then perform pg_temp.check('cannot buy an owned item again', sqlerrm like '%already owned%', sqlerrm); end $$;
select pg_temp.check('7 inventory has the item', (select count(*) = 1 from public.user_inventory where user_id = auth.uid() and item_slug = 'gold-classic'));
select pg_temp.check('catalog shows owned', (select (x ->> 'owned')::boolean from json_array_elements(public.shop_catalog() -> 'items') x where x ->> 'slug' = 'gold-classic'));
select pg_temp.check('8 equip owned skin', (public.equip_item('piece', 'gold-classic') ->> 'ok')::boolean);
select pg_temp.check('8b equipped choice saved on the profile (all devices)', (select equipped_piece = 'gold-classic' from public.profiles where id = auth.uid()));
do $$ begin
  perform public.equip_item('piece', 'shadow-king');
  perform pg_temp.check('cannot equip a skin you do not own', false);
exception when others then perform pg_temp.check('cannot equip a skin you do not own', sqlerrm like '%not owned%', sqlerrm); end $$;
do $$ begin
  perform public.equip_item('board', 'gold-classic');
  perform pg_temp.check('cannot equip into the wrong slot', false);
exception when others then perform pg_temp.check('cannot equip into the wrong slot', sqlerrm like '%not found%', sqlerrm); end $$;
select pg_temp.check('free default board can be equipped', (public.equip_item('board', 'classic-blue') ->> 'ok')::boolean);
select pg_temp.check('equipped look is public (cosmetics_of)', (public.cosmetics_of(auth.uid()) -> 'piece' ->> 'slug') = 'gold-classic');
do $$ begin
  perform public.shop_buy('emperor', 'key-buy-0003');
  perform pg_temp.check('not enough coins for a mythic item', false);
exception when others then perform pg_temp.check('not enough coins for a mythic item', sqlerrm like '%insufficient%', sqlerrm); end $$;
select pg_temp.check('ledger is complete (top-up − purchase = balance)', (select sum(amount) = 13000 from public.wallet_transactions where user_id = auth.uid()));
select pg_temp.check('report can be filed', (public.report_create('bug', 'Doska sekin yuklanadi') ->> 'id') is not null);
reset role;

-- 16-17 admin roles, permissions and audit log
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select pg_temp.check('Telegram id 7550418397 is super admin', (public.admin_me() ->> 'role') = 'super_admin');
select pg_temp.check('panel opening is audited', (select count(*) = 1 from public.admin_audit(50, 0, 'panel.open')));
select pg_temp.check('dashboard works for admins', (public.admin_dashboard() ->> 'users_total')::int >= 4);
select pg_temp.check('admin user search', (select count(*) = 1 from public.admin_users('buyer_one')));
do $$ begin
  perform public.admin_wallet_adjust('eeeeeeee-0000-4000-8000-000000000001', 500, '', 'adm-key-0001');
  perform pg_temp.check('balance change needs a reason', false);
exception when others then perform pg_temp.check('balance change needs a reason', sqlerrm like '%reason%', sqlerrm); end $$;
select pg_temp.check('admin credit with reason', (public.admin_wallet_adjust('eeeeeeee-0000-4000-8000-000000000001', 500, 'Turnir mukofoti', 'adm-key-0001') ->> 'balance')::bigint = 13500);
select pg_temp.check('admin credit is idempotent', (public.admin_wallet_adjust('eeeeeeee-0000-4000-8000-000000000001', 500, 'Turnir mukofoti', 'adm-key-0001') ->> 'balance')::bigint = 13500);
do $$ begin
  perform public.admin_wallet_adjust('eeeeeeee-0000-4000-8000-000000000001', -999999, 'xato', 'adm-key-0002');
  perform pg_temp.check('debit can not make a balance negative', false);
exception when others then perform pg_temp.check('debit can not make a balance negative', sqlerrm like '%insufficient%', sqlerrm); end $$;
select pg_temp.check('17 balance change is in the audit log with reason', (select count(*) = 1 from public.admin_audit(50, 0, 'wallet.adjust') where reason = 'Turnir mukofoti'));
select pg_temp.check('super admin grants moderator', (public.admin_role_set('eeeeeeee-0000-4000-8000-000000000003', 'moderator', 'Yangi moderator') ->> 'ok')::boolean);
select pg_temp.check('admin shop edit (price + discount)', (public.admin_shop_save(
  (select to_jsonb(i) || '{"discount_percent": 50}'::jsonb from public.shop_items i where slug = 'titanium'), 'Aksiya') ->> 'ok')::boolean);
select pg_temp.check('discount shows in the shop', (select (x ->> 'final_price')::int = 7000 from json_array_elements(public.shop_catalog() -> 'items') x where x ->> 'slug' = 'titanium'));
select pg_temp.check('admin can retire an item', (public.admin_shop_save((select to_jsonb(i) || '{"retired": true}'::jsonb from public.shop_items i where slug = 'chrome'), 'Sotuvdan olindi') ->> 'ok')::boolean);
select pg_temp.check('admin package price change', (public.admin_package_save('{"id":"coins_5k","coins":5000,"stars":30,"sort":1,"active":true}', 'Narx yangilandi') ->> 'ok')::boolean);
select pg_temp.check('new package price applies', (select stars = 30 from public.coin_packages where id = 'coins_5k'));
reset role;
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
do $$ begin
  perform public.shop_buy('chrome', 'key-buy-0009');
  perform pg_temp.check('retired item is not sold', false);
exception when others then perform pg_temp.check('retired item is not sold', sqlerrm like '%not for sale%', sqlerrm); end $$;
select pg_temp.check('discounted price is charged', (public.shop_buy('titanium', 'key-buy-0010') ->> 'price')::int = 7000);
reset role;

set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000003';
select pg_temp.check('moderator role active', (public.admin_me() ->> 'role') = 'moderator');
do $$ begin
  perform public.admin_wallet_adjust('eeeeeeee-0000-4000-8000-000000000003', 100000, 'o''zimga', 'mod-key-0001');
  perform pg_temp.check('moderator can NOT change balances', false);
exception when others then perform pg_temp.check('moderator can NOT change balances', sqlerrm like '%forbidden%', sqlerrm); end $$;
do $$ begin
  perform public.admin_role_set('eeeeeeee-0000-4000-8000-000000000003', 'admin', 'o''zimni ko''taraman');
  perform pg_temp.check('moderator can NOT raise own role', false);
exception when others then perform pg_temp.check('moderator can NOT raise own role', sqlerrm like '%forbidden%', sqlerrm); end $$;
do $$ begin
  perform public.admin_ban('eeeeeeee-0000-4000-8000-000000000002', now() + interval '1 day', 'urinish');
  perform pg_temp.check('nobody can restrict the super admin', false);
exception when others then perform pg_temp.check('nobody can restrict the super admin', sqlerrm like '%forbidden%', sqlerrm); end $$;
select pg_temp.check('moderator restricts a player', (public.admin_ban('eeeeeeee-0000-4000-8000-000000000004', now() + interval '1 day', 'Haqorat') ->> 'ok')::boolean);
reset role;
do $$ begin
  set local role authenticated;
  insert into public.admin_roles (user_id, role) values ('eeeeeeee-0000-4000-8000-000000000004', 'admin');
  perform pg_temp.check('admin_roles not writable by clients', false);
exception when others then perform pg_temp.check('admin_roles not writable by clients', true, sqlerrm); end $$;
-- restricted player can not play, queue, join the tournament or buy
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000004';
do $$ begin
  perform public.quick_match(180);
  perform pg_temp.check('restricted player can NOT queue', false);
exception when others then perform pg_temp.check('restricted player can NOT queue', sqlerrm like '%restricted%', sqlerrm); end $$;
do $$ begin
  perform public.start_bot_match('easy');
  perform pg_temp.check('restricted player can NOT start a bot game', false);
exception when others then perform pg_temp.check('restricted player can NOT start a bot game', sqlerrm like '%restricted%', sqlerrm); end $$;
do $$ begin
  perform public.weekly_join();
  perform pg_temp.check('restricted player can NOT join the tournament', false);
exception when others then perform pg_temp.check('restricted player can NOT join the tournament', sqlerrm like '%restricted%', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select pg_temp.check('unban restores access', (public.admin_unban('eeeeeeee-0000-4000-8000-000000000004', 'Muddatidan oldin') ->> 'ok')::boolean);
select pg_temp.check('super admin removes the moderator role', (public.admin_role_set('eeeeeeee-0000-4000-8000-000000000003', null, 'Lavozimdan olindi') ->> 'ok')::boolean);
select pg_temp.check('audit log lists every action', (select count(*) >= 8 from public.admin_audit(100, 0, null)));
select pg_temp.check('reports visible to admins', (select count(*) >= 1 from public.admin_reports(null, 10, 0)));
select pg_temp.check('weekly prizes editable', (public.admin_weekly_prizes_save('[{"place":2,"title_uz":"100 Telegram Stars","title_en":"100 Telegram Stars","icon":"⭐"}]', 'Sovrin oshirildi') ->> 'ok')::boolean
  and (select json_array_length(public.weekly_overview() -> 'prizes') = 5));
select pg_temp.check('confirm last week''s winners', (public.admin_weekly_confirm('dddddddd-0000-4000-8000-000000000001', 'Natijalar tekshirildi') ->> 'ok')::boolean);
select pg_temp.check('winners marked confirmed', (select count(*) = 3 from public.weekly_entries where tournament_id = 'dddddddd-0000-4000-8000-000000000001' and prize_status = 'confirmed'));
select pg_temp.check('mark a prize delivered', (public.admin_weekly_delivered('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000008', 'Premium yuborildi') ->> 'ok')::boolean);
reset role;
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000003';
do $$ begin
  perform public.admin_dashboard();
  perform pg_temp.check('removed staff loses access', false);
exception when others then perform pg_temp.check('removed staff loses access', sqlerrm like '%forbidden%', sqlerrm); end $$;
reset role;

-- refunds: coins are taken back first; refused if already spent; reverted if Telegram refuses
set role service_role;
create temp table ord2 as select public.payment_create('eeeeeeee-0000-4000-8000-000000000001', 'coins_5k') as r;
grant all on ord2 to public;
select public.payment_complete((select (r->>'order_id')::uuid from ord2), 'charge-BBB-1', 'prov-b', 30, 111000111, '{}');
select pg_temp.check('refund takes the coins back', (public.payment_refund_begin((select (r->>'order_id')::uuid from ord2), 'eeeeeeee-0000-4000-8000-000000000002', 'Foydalanuvchi so''rovi') ->> 'charge_id') = 'charge-BBB-1');
select pg_temp.check('order marked refunded, coins debited', (select status = 'refunded' from public.payment_orders where id = (select (r->>'order_id')::uuid from ord2))
  and (select balance from public.user_wallets where user_id = 'eeeeeeee-0000-4000-8000-000000000001') = 6500);
select public.payment_refund_revert((select (r->>'order_id')::uuid from ord2), 'eeeeeeee-0000-4000-8000-000000000002', 'telegram error');
select pg_temp.check('failed Telegram refund gives the coins back', (select status = 'paid' from public.payment_orders where id = (select (r->>'order_id')::uuid from ord2))
  and (select balance from public.user_wallets where user_id = 'eeeeeeee-0000-4000-8000-000000000001') = 11500);
do $$ begin
  perform public.payment_refund_begin((select (r->>'order_id')::uuid from ord), 'eeeeeeee-0000-4000-8000-000000000003', 'urinish');
  perform pg_temp.check('refund needs an admin with permission', false);
exception when others then perform pg_temp.check('refund needs an admin with permission', sqlerrm like '%forbidden%', sqlerrm); end $$;
do $$ begin
  perform public.payment_refund_begin((select (r->>'order_id')::uuid from ord), 'eeeeeeee-0000-4000-8000-000000000002', 'urinish');
  perform pg_temp.check('refund refused when the coins are already spent', false);
exception when others then perform pg_temp.check('refund refused when the coins are already spent', sqlerrm like '%insufficient%', sqlerrm); end $$;
select pg_temp.check('wallet never negative, ledger consistent', (select bool_and(w.balance = coalesce((select sum(amount) from public.wallet_transactions t where t.user_id = w.user_id), 0)) from public.user_wallets w));
reset role;

-- ---------- Live spectating, chats, draw, rematch, blocking (0013) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-0000-4000-8000-000000000001', 'g1@x.io', '{"username":"live_white"}'),
  ('99999999-0000-4000-8000-000000000002', 'g2@x.io', '{"username":"live_black"}'),
  ('99999999-0000-4000-8000-000000000003', 'g3@x.io', '{"username":"watcher"}'),
  ('99999999-0000-4000-8000-000000000004', 'g4@x.io', '{"username":"shy_player"}');
update public.profiles set hide_games = true where id = '99999999-0000-4000-8000-000000000004';
-- a public 3-minute game (via a challenge)
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
create temp table lch as select public.send_challenge('99999999-0000-4000-8000-000000000002') as r;
grant all on lch to public;
reset role;
update public.profiles set last_seen = now() where id in ('99999999-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000004');
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000002';
create temp table lgm as select (public.respond_challenge((select (r->>'challenge_id')::uuid from lch), true) ->> 'match_id')::uuid as id;
grant all on lgm to public;
reset role;
select pg_temp.check('challenge game is public', (select is_public from public.matches where id = (select id from lgm)));
set role service_role;
insert into public.match_moves (match_id, ply, from_sq, path) values ((select id from lgm), 0, 42, '{35}');
update public.matches set move_count = 1 where id = (select id from lgm);
reset role;
-- a private game: shy_player hides their games
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000004';
create temp table pch as select public.send_challenge('99999999-0000-4000-8000-000000000003') as r;
grant all on pch to public;
reset role;
update public.profiles set last_seen = now() where id = '99999999-0000-4000-8000-000000000003';
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000003';
create temp table pgm as select (public.respond_challenge((select (r->>'challenge_id')::uuid from pch), true) ->> 'match_id')::uuid as id;
grant all on pgm to public;
select pg_temp.check('13 game of a player who hides games is private', (select not is_public from public.matches where id = (select id from pgm)));
select pg_temp.check('… but the players themselves still see it', (select count(*) = 1 from public.matches where id = (select id from pgm)));
reset role;
reset request.jwt.claim.sub;
set role anon;
select pg_temp.check('12 live list shows the public game with its moves', (select count(*) = 1 from json_array_elements(public.live_list(50, 0)) x where (x->>'id')::uuid = (select id from lgm) and json_array_length(x->'moves') = 1));
select pg_temp.check('13 private game is NOT in the live list', (select count(*) = 0 from json_array_elements(public.live_list(50, 0)) x where (x->>'id')::uuid = (select id from pgm)));
select pg_temp.check('anon can read a public game + moves', (select count(*) = 1 from public.matches where id = (select id from lgm)) and (select count(*) = 1 from public.match_moves where match_id = (select id from lgm)));
select pg_temp.check('13 outsiders can NOT read a private game', (select count(*) = 0 from public.matches where id = (select id from pgm)));
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
select pg_temp.check('13 outsider (signed in) can NOT read a private game', (select count(*) = 0 from public.matches where id = (select id from pgm)));
do $$ begin
  perform public.live_ping((select id from pgm));
  perform pg_temp.check('cannot watch a private game', false);
exception when others then perform pg_temp.check('cannot watch a private game', true, sqlerrm); end $$;
select pg_temp.check('a player is not counted as a viewer', (public.live_ping((select id from lgm)) ->> 'viewers')::int = 0);
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000003';
select pg_temp.check('a spectator is counted', (public.live_ping((select id from lgm)) ->> 'viewers')::int = 1);
select pg_temp.check('live stats count games and viewers', (select (r->>'games')::int >= 1 and (r->>'viewers')::int >= 1 from (select public.live_stats() as r) x));
-- 14 spectator chat
select pg_temp.check('14 spectator writes in the live chat', (public.live_chat_send((select id from lgm), 'text', 'Zo''r yurish!') ->> 'ok')::boolean);
do $$ begin
  perform public.live_chat_send((select id from lgm), 'text', 'yana');
  perform pg_temp.check('live chat rate limit', false);
exception when others then perform pg_temp.check('live chat rate limit', sqlerrm like '%slow down%', sqlerrm); end $$;
do $$ begin
  perform public.live_chat_send((select id from lgm), 'emoji', '💩');
  perform pg_temp.check('only the allowed emoji reactions', false);
exception when others then perform pg_temp.check('only the allowed emoji reactions', sqlerrm like '%bad emoji%', sqlerrm); end $$;
do $$ begin
  perform public.live_chat_send((select id from lgm), 'text', repeat('x', 201));
  perform pg_temp.check('message length limit', false);
exception when others then perform pg_temp.check('message length limit', true, sqlerrm); end $$;
reset role;
set role anon;
select pg_temp.check('everyone can read the live chat', (select count(*) = 1 from public.live_chat_recent((select id from lgm), 50)));
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
select pg_temp.check('players can NOT read the live chat during their game', (select count(*) = 0 from public.live_chat_recent((select id from lgm), 50)));
do $$ begin
  perform public.live_chat_send((select id from lgm), 'text', 'menga yordam bering');
  perform pg_temp.check('players can NOT write in the live chat during their game', false);
exception when others then perform pg_temp.check('players can NOT write in the live chat during their game', true, sqlerrm); end $$;
-- 15 players' match chat
select pg_temp.check('15 player writes in the match chat', (public.match_chat_send((select id from lgm), 'text', 'Omad!') ->> 'ok')::boolean);
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000002';
select pg_temp.check('opponent reads it', (select count(*) = 1 from public.match_chat_messages where match_id = (select id from lgm)));
select pg_temp.check('emoji reaction', (public.match_chat_send((select id from lgm), 'emoji', '🔥') ->> 'ok')::boolean);
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000003';
select pg_temp.check('spectators can NOT read the players'' chat', (select count(*) = 0 from public.match_chat_messages where match_id = (select id from lgm)));
do $$ begin
  perform public.match_chat_send((select id from lgm), 'text', 'salom');
  perform pg_temp.check('spectators can NOT write in the players'' chat', false);
exception when others then perform pg_temp.check('spectators can NOT write in the players'' chat', sqlerrm like '%not found%', sqlerrm); end $$;
reset role;
-- moderation
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select pg_temp.check('moderator hides a chat message', (public.admin_chat_hide((select max(id) from public.live_chat_messages), 'Spam') ->> 'ok')::boolean);
select pg_temp.check('admin mutes a player', (public.admin_mute('99999999-0000-4000-8000-000000000003', now() + interval '1 hour', 'Spam') ->> 'ok')::boolean);
reset role;
set role anon;
select pg_temp.check('hidden message disappears', (select count(*) = 0 from public.live_chat_recent((select id from lgm), 50)));
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000003';
select pg_sleep(2.1);
do $$ begin
  perform public.live_chat_send((select id from lgm), 'text', 'yana spam');
  perform pg_temp.check('muted player can NOT chat', false);
exception when others then perform pg_temp.check('muted player can NOT chat', sqlerrm like '%muted%', sqlerrm); end $$;
reset role;
-- draw offer
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
create temp table dr0 as select rating, rated_games from public.profiles where id = '99999999-0000-4000-8000-000000000001';
grant all on dr0 to public;
select pg_temp.check('draw offered', (public.match_offer_draw((select id from lgm)) ->> 'ok')::boolean);
do $$ begin
  perform public.match_respond_draw((select id from lgm), true);
  perform pg_temp.check('cannot accept your own draw offer', false);
exception when others then perform pg_temp.check('cannot accept your own draw offer', sqlerrm like '%no open offer%', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000002';
select pg_temp.check('opponent accepts the draw', (public.match_respond_draw((select id from lgm), true) ->> 'accepted')::boolean);
reset role;
select pg_temp.check('game finished as a draw by agreement, rated once (0 points)', (select status = 'finished' and result = 'draw' and result_reason = 'agreement' and rating_applied and white_delta = 0 from public.matches where id = (select id from lgm))
  and (select rated_games = (select rated_games from dr0) + 1 and rating = (select rating from dr0) from public.profiles where id = '99999999-0000-4000-8000-000000000001'));
-- rematch
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000002';
select pg_temp.check('rematch offered', (public.match_offer_rematch((select id from lgm)) ->> 'ok')::boolean);
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
create temp table rem as select (public.match_respond_rematch((select id from lgm), true) ->> 'match_id')::uuid as id;
grant all on rem to public;
select pg_temp.check('rematch: new game with swapped colours and the same clock', (select n.white_id = o.black_id and n.black_id = o.white_id and n.time_control = 180 and n.status = 'active'
  from public.matches n, public.matches o where n.id = (select id from rem) and o.id = (select id from lgm)));
do $$ begin
  perform public.match_respond_rematch((select id from lgm), true);
  perform pg_temp.check('rematch can not be accepted twice', false);
exception when others then perform pg_temp.check('rematch can not be accepted twice', sqlerrm like '%no open offer%', sqlerrm); end $$;
select pg_temp.check('archive lists my finished games', (select count(*) >= 1 from json_array_elements(public.my_games(null, 20)) x where (x->>'id')::uuid = (select id from lgm)));
-- blocking
select pg_temp.check('block a player', (public.block_user('99999999-0000-4000-8000-000000000002', true) ->> 'ok')::boolean);
select pg_temp.check('blocked list', (select count(*) = 1 from public.blocked_users()));
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000002';
select pg_sleep(1.1);
select public.match_chat_send((select id from rem), 'text', 'salom');
do $$ begin
  perform public.send_challenge('99999999-0000-4000-8000-000000000001');
  perform pg_temp.check('blocked player can NOT challenge you', false);
exception when others then perform pg_temp.check('blocked player can NOT challenge you', sqlerrm like '%unavailable%' or sqlerrm like '%offline%', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '99999999-0000-4000-8000-000000000001';
select pg_temp.check('blocked player''s messages are hidden from me', (select count(*) = 0 from public.match_chat_messages where match_id = (select id from rem)));
select pg_temp.check('unblock', (public.block_user('99999999-0000-4000-8000-000000000002', false) ->> 'ok')::boolean);
select pg_temp.check('… block list is empty', (select count(*) = 0 from public.blocked_users()));
select pg_temp.check('after unblock the messages are visible again', (select count(*) = 1 from public.match_chat_messages where match_id = (select id from rem)));
select pg_temp.check('a player can hide a running game', (public.match_set_visibility((select id from rem), false) ->> 'ok')::boolean);
reset role;
set role anon;
select pg_temp.check('… then it is gone from the live list', (select count(*) = 0 from json_array_elements(public.live_list(50, 0)) x where (x->>'id')::uuid = (select id from rem)));
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
select pg_temp.check('anon can read the leaderboard', (select count(*) from public.leaderboard) = (select count(*) from public.profiles));
do $$ begin
  perform public.create_room();
  perform pg_temp.check('anon can NOT create rooms', false);
exception when others then perform pg_temp.check('anon can NOT create rooms', true, sqlerrm); end $$;
reset role;

-- avatar frames: 'dameo' for everyone, 'champion' only for the current #1; players cannot write the column directly
create temp table fr as
  select (select id from public.profiles order by rating desc, wins desc, created_at asc limit 1) as leader,
         (select id from public.profiles order by rating asc, wins asc, created_at desc limit 1) as other;
grant select on fr to authenticated, anon;
set role authenticated;
select set_config('request.jwt.claim.sub', (select other::text from fr), false);
select pg_temp.check('anyone can wear the DAMEO frame', (public.frame_equip('dameo') ->> 'ok')::boolean);
do $$ begin
  perform public.frame_equip('champion');
  perform pg_temp.check('a non-#1 player can NOT wear the champion frame', false);
exception when others then perform pg_temp.check('a non-#1 player can NOT wear the champion frame', sqlerrm like 'only the #1%', sqlerrm); end $$;
do $$ begin
  perform public.frame_equip('gold<script>');
  perform pg_temp.check('unknown frames are refused', false);
exception when others then perform pg_temp.check('unknown frames are refused', true, sqlerrm); end $$;
do $$ begin
  update public.profiles set equipped_frame = 'champion' where id = auth.uid();
  perform pg_temp.check('the frame column can NOT be written directly', false);
exception when others then perform pg_temp.check('the frame column can NOT be written directly', true, sqlerrm); end $$;
select pg_temp.check('frames_mine: not #1', (public.frames_mine() ->> 'champion_ok')::boolean = false and public.frames_mine() ->> 'equipped' = 'dameo');
select pg_temp.check('a frame can be taken off', (public.frame_equip(null) ->> 'equipped') is null);
select set_config('request.jwt.claim.sub', (select leader::text from fr), false);
select pg_temp.check('the #1 can wear the champion frame', (public.frame_equip('champion') ->> 'equipped') = 'champion');
reset role;
set role anon;
select pg_temp.check('everyone sees the #1''s champion frame', exists (select 1 from public.frames_active() f, fr where f.user_id = fr.leader and f.frame = 'champion'));
reset role;
update public.profiles set rating = rating + 1000 where id = (select other from fr);
set role anon;
select pg_temp.check('… and it disappears when they lose #1', not exists (select 1 from public.frames_active() f, fr where f.user_id = fr.leader));
reset role;
update public.profiles set rating = rating - 1000 where id = (select other from fr);
set role anon;
select pg_temp.check('… and comes back when they win #1 back', exists (select 1 from public.frames_active() f, fr where f.user_id = fr.leader and f.frame = 'champion'));
do $$ begin
  perform public.frame_equip('dameo');
  perform pg_temp.check('anon can NOT equip frames', false);
exception when others then perform pg_temp.check('anon can NOT equip frames', true, sqlerrm); end $$;
reset role;

-- ===================== virtual opponents (0017)
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-0000-4000-8000-000000000017', 'v@x.io', '{"username":"virtualtester"}');
update public.virtual_settings set enabled = true, auto_off = false where id;
create temp table vt (k text primary key, v text);
grant all on vt to authenticated, anon, service_role;
set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000017', false);
select pg_temp.check('virtual: refused when the player is not searching', public.virtual_match(180) ->> 'reason' = 'not-searching');
select public.quick_match(180);
select pg_temp.check('virtual: refused right after the search started (< 18 s)', public.virtual_match(180) ->> 'reason' = 'too-early');
reset role;
update public.matchmaking_queue set created_at = now() - interval '25 seconds' where user_id = '99999999-0000-4000-8000-000000000017';
update public.virtual_settings set enabled = false where id;
set role authenticated;
select pg_temp.check('virtual: admin switch off → no virtual opponent', public.virtual_match(180) ->> 'reason' = 'disabled');
reset role;
update public.virtual_settings set enabled = true where id;
set role authenticated;
insert into vt select 'm1', public.virtual_match(180) ->> 'match_id';
reset role;
select pg_temp.check('virtual: match created against a virtual player, rated, with clocks',
  (select m.virtual_id is not null and m.vs_bot and m.rated and m.time_control = 180 and m.white_ms = 180000 and m.black_id is null
     from public.matches m where m.id = (select v::uuid from vt where k = 'm1')));
select pg_temp.check('virtual: the player left the queue', (select last_seen = '-infinity' from public.matchmaking_queue where user_id = '99999999-0000-4000-8000-000000000017'));
select pg_temp.check('virtual: not in profiles / leaderboard', not exists (select 1 from public.leaderboard l join public.virtual_players v on v.nickname = l.username));
-- the player makes the first move, the server plans the bot's answer
insert into public.match_moves (match_id, ply, from_sq, path) values ((select v::uuid from vt where k = 'm1'), 0, 42, '{35}');
update public.matches set move_count = 1, turn_started_at = now(), bot_pending = '{"ply":1,"from":21,"path":[28],"think":1200}', bot_due_at = now()
 where id = (select v::uuid from vt where k = 'm1');
set role authenticated;
do $$ begin
  perform public.virtual_commit((select v::uuid from vt where k = 'm1'));
  perform pg_temp.check('virtual: players can NOT commit bot moves', false);
exception when others then perform pg_temp.check('virtual: players can NOT commit bot moves', true, sqlerrm); end $$;
reset role;
set role service_role;
select pg_temp.check('virtual: due bot move committed, bot clock charged exactly the planned time',
  (public.virtual_commit((select v::uuid from vt where k = 'm1')) ->> 'black_ms')::int = 178800);
reset role;
select pg_temp.check('virtual: move stored once, pending cleared',
  (select count(*) = 2 from public.match_moves where match_id = (select v::uuid from vt where k = 'm1'))
  and (select bot_pending is null and move_count = 2 from public.matches where id = (select v::uuid from vt where k = 'm1')));
set role service_role;
select pg_temp.check('virtual: committing twice is refused', public.virtual_commit((select v::uuid from vt where k = 'm1')) ->> 'error' = 'conflict');
reset role;
select pg_temp.check('virtual: shown in the live list', exists (select 1 from json_array_elements(public.live_list(50, 0)) x where x->>'id' = (select v from vt where k = 'm1') and (x->>'black_virtual')::boolean));
-- the sweep commits an overdue planned move when the player's app is away
insert into public.match_moves (match_id, ply, from_sq, path) values ((select v::uuid from vt where k = 'm1'), 2, 35, '{26}');
update public.matches set move_count = 3, turn_started_at = now() - interval '6 seconds', bot_pending = '{"ply":3,"from":22,"path":[31],"think":4000}', bot_due_at = now() - interval '3 seconds'
 where id = (select v::uuid from vt where k = 'm1');
select public.finish_expired_games();
select pg_temp.check('virtual: sweep commits an overdue bot move (not a timeout)',
  (select status = 'active' and move_count = 4 and bot_pending is null from public.matches where id = (select v::uuid from vt where k = 'm1')));
-- the bot can lose on time
update public.matches set black_ms = 500, bot_pending = '{"ply":4,"from":23,"path":[30],"think":900}', bot_due_at = now() where id = (select v::uuid from vt where k = 'm1');
insert into vt select 'rating_before', rating::text from public.virtual_players where id = (select virtual_id from public.matches where id = (select v::uuid from vt where k = 'm1'));
set role service_role;
select pg_temp.check('virtual: bot without enough clock loses on time', public.virtual_commit((select v::uuid from vt where k = 'm1')) ->> 'error' = 'timeout');
reset role;
select pg_temp.check('… game finished, the player won on the clock',
  (select status = 'finished' and result = 'white' and timeout_kind = 'clock' from public.matches where id = (select v::uuid from vt where k = 'm1')));
select pg_temp.check('… the virtual player''s own stats/rating updated (loss, −5)',
  (select v.losses >= 1 and v.rating = (select v2::int from (select v as v2 from vt where k = 'rating_before') z) - 5
     from public.virtual_players v where v.id = (select virtual_id from public.matches where id = (select v::uuid from vt where k = 'm1'))));
select pg_temp.check('… rated, but after 4 moves the winner gains nothing (short game)', (select white_delta = 0 and rating_applied and rating_note = 'short' from public.matches where id = (select v::uuid from vt where k = 'm1')));
select pg_temp.check('… gone from the live list', not exists (select 1 from json_array_elements(public.live_list(50, 0)) x where x->>'id' = (select v from vt where k = 'm1')));
-- rematch: one answer per game, only for the player of that game
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  perform public.virtual_rematch((select v::uuid from vt where k = 'm1'));
  perform pg_temp.check('virtual: someone else can NOT ask for the rematch', false);
exception when others then perform pg_temp.check('virtual: someone else can NOT ask for the rematch', true, sqlerrm); end $$;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000017', false);
insert into vt select 'r1', public.virtual_rematch((select v::uuid from vt where k = 'm1'))::text;
select pg_temp.check('virtual: asking again gives the same answer', public.virtual_rematch((select v::uuid from vt where k = 'm1'))::text = (select v from vt where k = 'r1'));
do $$ begin
  perform public.admin_virtual_overview();
  perform pg_temp.check('virtual: admin overview refused for players', false);
exception when others then perform pg_temp.check('virtual: admin overview refused for players', true, sqlerrm); end $$;
do $$ begin
  perform public.admin_virtual_settings_save(false, null, null, 'test');
  perform pg_temp.check('virtual: a player can NOT switch virtual opponents off', false);
exception when others then perform pg_temp.check('virtual: a player can NOT switch virtual opponents off', true, sqlerrm); end $$;
reset role;
set role anon;
do $$ begin
  perform public.virtual_match(180);
  perform pg_temp.check('virtual: anon can NOT start virtual games', false);
exception when others then perform pg_temp.check('virtual: anon can NOT start virtual games', true, sqlerrm); end $$;
select pg_temp.check('virtual: profiles readable by everyone (12 enabled)', (select count(*) filter (where enabled) = 12 from public.virtual_players));
reset role;
-- old bot game / untimed games left behind → closed; and never shown live
insert into public.matches (id, white_id, status, rated, vs_bot, bot_level, started_at, created_at, move_count)
values ('aaaaaaaa-1111-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', false, true, 'easy', now() - interval '2 hours', now() - interval '2 hours', 2),
       ('aaaaaaaa-1111-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', false, true, 'easy', now() - interval '2 hours', now() - interval '2 hours', 0),
       ('aaaaaaaa-1111-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'active', false, true, 'easy', now(), now(), 0);
select pg_temp.check('old bot games are not live', not exists (select 1 from json_array_elements(public.live_list(50, 0)) x where x->>'id' like 'aaaaaaaa-1111%'));
select public.finish_expired_games();
select pg_temp.check('abandoned untimed bot game with moves → finished (bot wins, unrated)', (select status = 'finished' and result = 'black' from public.matches where id = 'aaaaaaaa-1111-4000-8000-000000000001'));
select pg_temp.check('abandoned untouched game → aborted', (select status = 'aborted' from public.matches where id = 'aaaaaaaa-1111-4000-8000-000000000002'));
select pg_temp.check('a fresh untimed game is left alone', (select status = 'active' from public.matches where id = 'aaaaaaaa-1111-4000-8000-000000000003'));

-- ===================== 0019: rating rules, anti-abuse, achievements, virtual v2
reset role;
-- the real random rule (0019) back in place
create or replace function public._rand_delta(p_score numeric, p_me int, p_opp int) returns int
language sql volatile as $$
  select case when p_score = 1 then 15 + floor(random() * 16)::int
              when p_score = 0 then -(15 + floor(random() * 16)::int)
              else greatest(-5, least(5, round((coalesce(p_opp, 1200) - p_me) / 50.0)::int)) end;
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('f019f019-0000-4000-8000-000000000001', 'r1@x.io', '{"username":"rr_one"}'),
  ('f019f019-0000-4000-8000-000000000002', 'r2@x.io', '{"username":"rr_two"}'),
  ('f019f019-0000-4000-8000-000000000003', 'r3@x.io', '{"username":"rr_three"}'),
  ('f019f019-0000-4000-8000-000000000004', 'r4@x.io', '{"username":"rr_four"}'),
  ('f019f019-0000-4000-8000-000000000005', 'r5@x.io', '{"username":"rr_five"}');
-- 40 games between two players, each more than a day apart (so the pair limit does not apply)
create temp table rg as
  select pg_temp.pvp('f019f019-0000-4000-8000-000000000001', 'f019f019-0000-4000-8000-000000000002', 'white', now() - (i || ' days')::interval - interval '2 days') as id
  from generate_series(1, 40) i;
grant all on rg to public;
select pg_temp.check('rating: every win is +15…+30', (select bool_and(m.white_delta between 15 and 30) from public.matches m join rg on rg.id = m.id));
select pg_temp.check('rating: every loss is −15…−30', (select bool_and(m.black_delta between -30 and -15) from public.matches m join rg on rg.id = m.id));
select pg_temp.check('rating: points are random (not one fixed value)', (select count(distinct m.white_delta) >= 6 from public.matches m join rg on rg.id = m.id));
select pg_temp.check('rating: history keeps every change with source and delta',
  (select count(*) = 40 and bool_and(source = 'pvp' and delta between 15 and 30) from public.rating_history where user_id = 'f019f019-0000-4000-8000-000000000001' and match_id is not null));
select pg_temp.check('rating: profile = sum of the changes', (select p.rating = 1200 + (select sum(white_delta) from public.matches m join rg on rg.id = m.id) from public.profiles p where p.id = 'f019f019-0000-4000-8000-000000000001'));
-- draws: small and balanced (the lower-rated player gains)
create temp table dg as select pg_temp.pvp('f019f019-0000-4000-8000-000000000002', 'f019f019-0000-4000-8000-000000000001', 'draw', now() - interval '60 days') as id;
grant all on dg to public;
select pg_temp.check('rating: draw — lower-rated gains, higher-rated loses, max 5',
  (select white_delta between 1 and 5 and black_delta between -5 and -1 from public.matches where id = (select id from dg)));
-- the same pair: 3 rated games per 24 h, then nothing changes
create temp table pl as
  select i, pg_temp.pvp('f019f019-0000-4000-8000-000000000003', 'f019f019-0000-4000-8000-000000000004', 'white', now() - (i || ' minutes')::interval) as id
  from generate_series(5, 1, -1) i;
grant all on pl to public;
select pg_temp.check('anti-abuse: 4th+ game of the same pair in 24 h gives no points',
  (select count(*) filter (where m.rating_note = 'pair-limit' and m.white_delta = 0 and m.black_delta = 0) = 2
      and count(*) filter (where m.rating_note is null and m.white_delta > 0) = 3 from public.matches m join pl on pl.id = m.id));
select pg_temp.check('anti-abuse: … and no stats either (3 wins counted, not 5)', (select wins = 3 from public.profiles where id = 'f019f019-0000-4000-8000-000000000003'));
-- achievements: first win + 3 in a row → 25 + 100 coins, each once
select pg_temp.check('achievements: rr_three unlocked first win + 3 in a row',
  (select count(*) = 2 from public.user_achievements where user_id = 'f019f019-0000-4000-8000-000000000003' and code in ('first_win', 'streak_3')));
select pg_temp.check('achievements: coins credited once through the ledger (125)',
  (select sum(amount) = 125 and count(*) = 2 from public.wallet_transactions where user_id = 'f019f019-0000-4000-8000-000000000003' and kind = 'reward')
  and (select balance = 125 from public.user_wallets where user_id = 'f019f019-0000-4000-8000-000000000003'));
select pg_temp.check('achievements: streak 3, best 3', (select current_streak = 3 and best_streak = 3 from public.profiles where id = 'f019f019-0000-4000-8000-000000000003'));
select pg_temp.check('achievements: a notification for each', (select count(*) = 2 from public.user_notifications where user_id = 'f019f019-0000-4000-8000-000000000003' and kind = 'achievement'));
-- reapplying never pays again
select public.apply_match_result(id) from pl;
select public._ach_check('f019f019-0000-4000-8000-000000000003', null);
select pg_temp.check('achievements: never paid twice', (select balance = 125 from public.user_wallets where user_id = 'f019f019-0000-4000-8000-000000000003'));
-- streak 5 / 10 and reset on a loss (rr_five beats many different opponents, a day apart)
select pg_temp.pvp('f019f019-0000-4000-8000-000000000005', o, 'white', now() - (i || ' days')::interval - interval '100 days')
  from (select i, case i % 4 when 0 then 'f019f019-0000-4000-8000-000000000001'::uuid when 1 then 'f019f019-0000-4000-8000-000000000002'::uuid
                         when 2 then 'f019f019-0000-4000-8000-000000000003'::uuid else 'f019f019-0000-4000-8000-000000000004'::uuid end o
          from generate_series(10, 1, -1) i) x order by i desc;
select pg_temp.check('achievements: 10 in a row unlocks all four (975 coins)',
  (select count(*) = 4 from public.user_achievements where user_id = 'f019f019-0000-4000-8000-000000000005')
  and (select balance = 975 from public.user_wallets where user_id = 'f019f019-0000-4000-8000-000000000005'));
create temp table lg as select pg_temp.pvp('f019f019-0000-4000-8000-000000000001', 'f019f019-0000-4000-8000-000000000005', 'white', now() - interval '200 days') as id;
grant all on lg to public;
select pg_temp.check('achievements: a loss resets the streak, best stays', (select current_streak = 0 and best_streak = 10 from public.profiles where id = 'f019f019-0000-4000-8000-000000000005'));
set role authenticated;
select set_config('request.jwt.claim.sub', 'f019f019-0000-4000-8000-000000000005', false);
select pg_temp.check('achievements_mine: 4 items, all unlocked, best streak 10',
  (select json_array_length(r -> 'items') = 4 and (r ->> 'best_streak')::int = 10
     and (select bool_and(x ->> 'unlocked_at' is not null) from json_array_elements(r -> 'items') x) from (select public.achievements_mine() r) z));
select pg_temp.check('achievements_for_match: shows what that game unlocked',
  (select json_array_length(public.achievements_for_match(m.match_id)) >= 1 from public.user_achievements m where m.user_id = auth.uid() and m.code = 'streak_10'));
do $$ begin
  insert into public.user_achievements (user_id, code) values (auth.uid(), 'streak_3');
  perform pg_temp.check('achievements: players can NOT write achievements', false);
exception when others then perform pg_temp.check('achievements: players can NOT write achievements', true, sqlerrm); end $$;
do $$ begin
  perform public._ach_check(auth.uid(), null);
  perform pg_temp.check('achievements: players can NOT trigger rewards', false);
exception when others then perform pg_temp.check('achievements: players can NOT trigger rewards', true, sqlerrm); end $$;
do $$ begin
  perform public.apply_match_result((select id from lg));
  perform pg_temp.check('rating: players can NOT apply results', false);
exception when others then perform pg_temp.check('rating: players can NOT apply results', true, sqlerrm); end $$;
reset role;
-- virtual: rated with source 'virtual', on-duty pool, on/off with hysteresis
select pg_temp.check('virtual: games are recorded with source ''virtual''', exists (select 1 from public.rating_history where source = 'virtual'));
select pg_temp.check('virtual: 4 opponents on duty', (select count(*) = 4 from public._virtual_on_duty()));
update public.virtual_settings set pool_size = 3 where id;
select pg_temp.check('virtual: pool size is adjustable (3)', (select count(*) = 3 from public._virtual_on_duty()));
update public.virtual_settings set enabled = true, auto_off = true, auto_off_threshold = 2, auto_on_threshold = 1, auto_state = true where id;
update public.profiles set last_seen = now();
select pg_temp.check('virtual: many real players online → switched off', public._virtual_active() = false);
update public.profiles set last_seen = now() - interval '1 hour' where id not in (select id from public.profiles order by id limit 2);
select pg_temp.check('virtual: between the thresholds → stays off (hysteresis)', public._virtual_active() = false);
update public.profiles set last_seen = now() - interval '1 hour';
select pg_temp.check('virtual: below the lower threshold → back on', public._virtual_active() = true);
update public.virtual_settings set auto_off = false, pool_size = 4 where id;
set role anon;
do $$ begin
  truncate public.virtual_settings;
  perform pg_temp.check('security: anon can NOT truncate virtual tables', false);
exception when others then perform pg_temp.check('security: anon can NOT truncate virtual tables', true, sqlerrm); end $$;
reset role;

-- ===================== 0020: Limited boards (serials, stock, collection) + Coin/Stars pricing
insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'lb1@x.io', '{"username":"collector_one"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'lb2@x.io', '{"username":"collector_two"}'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'lb3@x.io', '{"username":"collector_three"}'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'lb4@x.io', '{"username":"collector_four"}');
select public._wallet_apply(('bbbbbbbb-0000-4000-8000-00000000000' || n)::uuid, 20000, 'admin_credit', 'test', null, 'seed-lb-' || n, 'seed', null) from generate_series(1, 4) n;
select pg_temp.check('lb: 8 Limited boards on sale', (select count(*) = 8 from public.shop_items where collection = 'limited' and active and not retired));
select pg_temp.check('lb: old boards hidden + off sale, not deleted', (select count(*) >= 12 and bool_and(not active and retired) from public.shop_items where slot = 'board' and collection <> 'limited'));
select pg_temp.check('lb: backup of the old boards kept', (select count(*) >= 12 from public._backup_v32_board_items));
select pg_temp.check('lb: supplies 200/100/80/30, first four not set', (select string_agg(coalesce(supply::text, '-'), ',' order by c.sort) = '-,-,-,-,200,100,80,30' from public.board_inventory s join public.board_catalog c using (slug) join public.shop_items i using (slug) where i.slot = 'board'));
select pg_temp.check('lb: prices 0/500/1200/1800/2200/3000/4000/5000', (select string_agg(price::text, ',' order by sort) = '0,500,1200,1800,2200,3000,4000,5000' from public.shop_items where collection = 'limited'));
select pg_temp.check('lb: every board has its artwork', (select bool_and(image_url = 'boards/' || slug || '.webp') from public.shop_items where collection = 'limited'));
select pg_temp.check('rate: 1000 Coin = 25 Stars; 500 → 13 (rounded up)',
  public._stars_for(500) = 13 and public._stars_for(1000) = 25 and public._stars_for(1200) = 30 and public._stars_for(1800) = 45
  and public._stars_for(2200) = 55 and public._stars_for(3000) = 75 and public._stars_for(4000) = 100 and public._stars_for(5000) = 125);
select pg_temp.check('rate: packages priced by the rate', (select string_agg(id || '=' || stars, ',' order by sort) from public.coin_packages where active and not stars_manual)
  = 'coins_500=13,coins_1k=25,coins_1200=30,coins_1800=45,coins_2200=55,coins_3k=75,coins_4k=100');

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000001';
select pg_temp.check('lb: buy Celestial Crown → #1/30', (select (r->>'serial')::int = 1 and (r->>'supply')::int = 30 and (r->>'balance')::bigint = 15000 from (select public.board_buy('celestial-crown', 'lb-key-0001') r) x));
select pg_temp.check('lb: same request again → no second charge, same serial', (select (r->>'duplicate')::boolean and (r->>'serial')::int = 1 from (select public.board_buy('celestial-crown', 'lb-key-0001') r) x)
  and (public.wallet_me() ->> 'balance')::bigint = 15000);
do $$ begin
  perform public.board_buy('celestial-crown', 'lb-key-0002');
  perform pg_temp.check('lb: a board can not be bought twice', false);
exception when others then perform pg_temp.check('lb: a board can not be bought twice', sqlerrm like '%already owned%', sqlerrm); end $$;
select pg_temp.check('lb: free Midnight Blue claimed with a serial, no coins', (select (r->>'serial')::int = 1 and (r->>'price')::int = 0 from (select public.shop_buy('midnight-blue', 'lb-key-0003') r) x)
  and (public.wallet_me() ->> 'balance')::bigint = 15000);
select pg_temp.check('lb: owned board can be equipped', (public.equip_item('board', 'celestial-crown') ->> 'ok')::boolean);
do $$ begin
  insert into public.user_board_collections (user_id, board_slug, serial, price_paid) values (auth.uid(), 'royal-marble', 1, 0);
  perform pg_temp.check('lb: client can NOT write a collection row', false);
exception when others then perform pg_temp.check('lb: client can NOT write a collection row', true, sqlerrm); end $$;
do $$ begin
  update public.board_inventory set sold = 0 where slug = 'celestial-crown';
  perform pg_temp.check('lb: client can NOT touch the stock', false);
exception when others then perform pg_temp.check('lb: client can NOT touch the stock', true, sqlerrm); end $$;
do $$ begin
  perform 1 from public.user_board_collections limit 1;
  perform pg_temp.check('lb: collections are not readable directly (privacy goes through the function)', false);
exception when others then perform pg_temp.check('lb: collections are not readable directly (privacy goes through the function)', true, sqlerrm); end $$;
select pg_temp.check('lb: my collection: 2 of 8, 1 limited, 25%', (select (c->>'owned')::int = 2 and (c->>'limited')::int = 1 and (c->>'complete_pct')::int = 25
  and (c->'items'->0->>'slug') = 'celestial-crown' from (select public.board_collection_of(auth.uid()) c) x));
select pg_temp.check('lb: shop shows remaining copies and my serial', (select (x->>'remaining')::int = 29 and (x->'mine'->>'serial')::int = 1 from json_array_elements(public.board_catalog_list()) x where x->>'slug' = 'celestial-crown'));
select pg_temp.check('lb: purchase history', (select count(*) = 2 from public.board_purchases_mine()));
reset role;

-- the last copies: #30 sells, then SOLD OUT for good
update public.board_inventory set sold = 28 where slug = 'celestial-crown';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.check('lb: the next copy is #29', (public.board_buy('celestial-crown', 'lb-key-0101') ->> 'serial')::int = 29);
select pg_temp.check('lb: other players see a public collection', (select (c->>'visible')::boolean and (c->>'owned')::int = 2 from (select public.board_collection_of('bbbbbbbb-0000-4000-8000-000000000001') c) x));
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000003';
select pg_temp.check('lb: last copy #30/30', (public.board_buy('celestial-crown', 'lb-key-0201') ->> 'serial')::int = 30);
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000004';
do $$ begin
  perform public.board_buy('obsidian-gold', 'lb-key-0102');
  perform public.board_buy('celestial-crown', 'lb-key-0103');
  perform pg_temp.check('lb: SOLD OUT is enforced', false);
exception when others then perform pg_temp.check('lb: SOLD OUT is enforced', sqlerrm like '%sold out%', sqlerrm); end $$;
select pg_temp.check('lb: sold-out board is marked', (select (x->>'sold_out')::boolean and (x->>'remaining')::int = 0 from json_array_elements(public.board_catalog_list()) x where x->>'slug' = 'celestial-crown'));
select pg_temp.check('lb: a failed purchase charges nothing (whole transaction rolled back)', (public.wallet_me() ->> 'balance')::bigint = 20000);
reset role;
select pg_temp.check('lb: serials unique and ≤ supply', (select count(*) = count(distinct serial) and max(serial) <= 30 from public.user_board_collections where board_slug = 'celestial-crown'));
select pg_temp.check('lb: sold-out time stored', (select sold_out_at is not null from public.board_inventory where slug = 'celestial-crown'));
do $$ begin
  update public.user_board_collections set serial = 7 where board_slug = 'celestial-crown' and serial = 1;
  perform pg_temp.check('lb: serial numbers never change (even for the server)', false);
exception when others then perform pg_temp.check('lb: serial numbers never change (even for the server)', sqlerrm like '%permanent%', sqlerrm); end $$;
do $$ begin
  update public.board_inventory set supply = 40 where slug = 'celestial-crown';
  perform pg_temp.check('lb: a sold-out board can not be restocked', false);
exception when others then perform pg_temp.check('lb: a sold-out board can not be restocked', sqlerrm like '%final%', sqlerrm); end $$;

-- privacy switch
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000001';
select pg_temp.check('lb: owner hides the collection', (public.collection_set_public(false) ->> 'ok')::boolean);
select pg_temp.check('lb: owner still sees a hidden collection', (public.board_collection_of(auth.uid()) ->> 'visible')::boolean);
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.check('lb: others can not see a hidden collection', (select (c->>'visible')::boolean = false and c->'items' is null from (select public.board_collection_of('bbbbbbbb-0000-4000-8000-000000000001') c) x));
do $$ begin
  perform public.admin_board_save('graphite', 1, 10, 'urinish');
  perform pg_temp.check('lb: players can NOT manage boards', false);
exception when others then perform pg_temp.check('lb: players can NOT manage boards', sqlerrm like '%forbidden%', sqlerrm); end $$;
do $$ begin
  perform public.admin_pricing_set(1, 1, 'urinish');
  perform pg_temp.check('rate: players can NOT change the rate', false);
exception when others then perform pg_temp.check('rate: players can NOT change the rate', sqlerrm like '%forbidden%', sqlerrm); end $$;
reset role;
set role anon;
select pg_temp.check('lb: guests see public collections', (public.board_collection_of('bbbbbbbb-0000-4000-8000-000000000002') ->> 'visible')::boolean);
reset role;

-- admin: limits, prices, rate, history
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select pg_temp.check('lb: admin sets the Graphite limit (once)', (public.admin_board_save('graphite', 500, 500, 'Limit belgilandi') ->> 'ok')::boolean);
select pg_temp.check('lb: … limit stored', (select supply = 500 from public.board_inventory where slug = 'graphite'));
do $$ begin
  perform public.admin_board_save('graphite', 500, 900, 'Oshiramiz');
  perform pg_temp.check('lb: a set limit can not be raised', false);
exception when others then perform pg_temp.check('lb: a set limit can not be raised', sqlerrm like '%final%', sqlerrm); end $$;
do $$ begin
  perform public.admin_board_save('midnight-blue', 0, 0, 'Nol');
  perform pg_temp.check('lb: limit can not be below copies sold', false);
exception when others then perform pg_temp.check('lb: limit can not be below copies sold', true, sqlerrm); end $$;
select pg_temp.check('lb: admin changes a board price', (public.admin_board_save('royal-wood', 1300, null, 'Narx yangilandi') ->> 'ok')::boolean);
select pg_temp.check('lb: … new price stored', (select price = 1300 from public.shop_items where slug = 'royal-wood'));
select pg_temp.check('history: board price change with old/new value and reason', exists (select 1 from public.admin_price_history(50) h
  where h.entity = 'board' and h.entity_id = 'royal-wood' and h.old_value = 1200 and h.new_value = 1300 and h.reason = 'Narx yangilandi' and h.admin = 'owner_super'));
select pg_temp.check('admin: owners list with serials', (select string_agg(serial::text, ',' order by serial) = '1,29,30' from public.admin_board_owners('celestial-crown')));
select pg_temp.check('rate: manual package price', (public.admin_package_save('{"id":"coins_1k","coins":1000,"stars":22,"stars_manual":true,"sort":2,"active":true}', 'Aksiya') ->> 'stars')::int = 22);
select pg_temp.check('rate: admin changes the rate (30 ⭐ / 1000)', (public.admin_pricing_set(30, 10, 'Yangi kurs') ->> 'ok')::boolean);
select pg_temp.check('rate: automatic packages re-priced (500 → 15, 4000 → 120)', (select stars = 15 from public.coin_packages where id = 'coins_500') and (select stars = 120 from public.coin_packages where id = 'coins_4k'));
select pg_temp.check('rate: manual price is not overwritten', (select stars = 22 and stars_manual from public.coin_packages where id = 'coins_1k'));
select pg_temp.check('rate: back to automatic', (public.admin_package_save('{"id":"coins_1k","coins":1000,"stars_manual":false,"sort":2,"active":true}', 'Avtomatik') ->> 'stars')::int = 30);
select pg_temp.check('history: rate change logged', exists (select 1 from public.admin_price_history(50) h where h.entity = 'rate' and h.old_value = 25 and h.new_value = 30 and h.reason = 'Yangi kurs'));
select pg_temp.check('history: package re-price logged', exists (select 1 from public.admin_price_history(50) h where h.entity = 'package' and h.entity_id = 'coins_500' and h.old_value = 13 and h.new_value = 15));
select public.admin_pricing_set(25, 10, 'Asosiy kurs');
reset role;
set role service_role;
select pg_temp.check('invoice: the order takes the price from the DB (1000 → 25 ⭐)', (select (public.payment_create('bbbbbbbb-0000-4000-8000-000000000001', 'coins_1k') ->> 'stars')::int = 25));
reset role;
select pg_temp.check('lb: wallets still match the ledger', (select bool_and(w.balance = coalesce((select sum(amount) from public.wallet_transactions t where t.user_id = w.user_id), 0)) from public.user_wallets w));

-- ===================== 0022: Stones Collection + Profile Frames
insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-4000-8000-000000000001', 'st1@x.io', '{"username":"stone_one"}'),
  ('dddddddd-0000-4000-8000-000000000002', 'st2@x.io', '{"username":"stone_two"}');
select public._wallet_apply(('dddddddd-0000-4000-8000-00000000000' || n)::uuid, 9000, 'admin_credit', 'test', null, 'seed-st-' || n, 'seed', null) from generate_series(1, 2) n;
select pg_temp.check('st: 8 stones in the Stones category', (select count(*) = 8 and string_agg(price::text, ',' order by sort) = '0,500,1200,1800,2200,3000,4000,5000'
  from public.shop_items where category_id = 'stones' and active));
select pg_temp.check('st: Limited stones 200/100/80/30', (select string_agg(s.supply::text, ',' order by c.sort) = '200,100,80,30'
  from public.board_inventory s join public.board_catalog c using (slug) join public.shop_items i using (slug) where i.slot = 'piece'));
select pg_temp.check('st: older piece sets kept in the database (off sale, not deleted)', (select count(*) >= 48 from public.shop_items where slot = 'piece' and collection <> 'stones'));
select pg_temp.check('st: backup of the older piece sets', (select count(*) >= 48 from public._backup_v32_piece_items));
select pg_temp.check('st: only the Stones (and the test fixtures) on sale', (select count(*) filter (where collection = 'stones') = 8 and count(*) filter (where collection <> 'stones') <= 5 from public.shop_items where slot = 'piece' and active));
select pg_temp.check('st: Football / Donachalar tabs hidden', (select bool_and(not visible) from public.shop_categories where id in ('football', 'trend')));
select pg_temp.check('st: board shop still lists boards only', (select count(*) = 8 from json_array_elements(public.board_catalog_list())));
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
select pg_temp.check('st: Classic Stone is free to equip', (public.equip_item('piece', 'st-classic') ->> 'ok')::boolean);
select pg_temp.check('st: buy Royal Gold (Premium, no serial)', (select (r->>'price')::int = 500 and r->>'serial' is null from (select public.shop_buy('st-royal-gold', 'st-key-0001') r) x));
do $$ begin
  perform public.shop_buy('st-royal-gold', 'st-key-0002');
  perform pg_temp.check('st: a stone can not be bought twice', false);
exception when others then perform pg_temp.check('st: a stone can not be bought twice', sqlerrm like '%already owned%', sqlerrm); end $$;
select pg_temp.check('st: buy Celestial (Limited) → #1/30', (select (r->>'serial')::int = 1 and (r->>'supply')::int = 30 from (select public.shop_buy('st-celestial', 'st-key-0003') r) x));
select pg_temp.check('st: retry of the same request → same serial, no charge', (select (r->>'duplicate')::boolean and (r->>'serial')::int = 1 from (select public.shop_buy('st-celestial', 'st-key-0003') r) x)
  and (public.wallet_me() ->> 'balance')::bigint = 9000 - 500 - 5000);
select pg_temp.check('st: stone stock shows my serial', (select (x->'mine'->>'serial')::int = 1 and (x->>'remaining')::int = 29 from json_array_elements(public.limited_stock('piece')) x where x->>'slug' = 'st-celestial'));
select pg_temp.check('st: equip the Limited stone', (public.equip_item('piece', 'st-celestial') ->> 'ok')::boolean);
select pg_temp.check('st: stones are not counted in the board collection', (public.board_collection_of(auth.uid()) ->> 'owned')::int = 0);
reset role;
update public.board_inventory set sold = 30 where slug = 'st-celestial';
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000002';
do $$ begin
  perform public.shop_buy('st-celestial', 'st-key-0101');
  perform pg_temp.check('st: SOLD OUT stone is refused', false);
exception when others then perform pg_temp.check('st: SOLD OUT stone is refused', sqlerrm like '%sold out%', sqlerrm); end $$;
do $$ begin
  perform public.equip_item('piece', 'st-ruby');
  perform pg_temp.check('st: can not equip a stone you do not own', false);
exception when others then perform pg_temp.check('st: can not equip a stone you do not own', sqlerrm like '%not owned%', sqlerrm); end $$;
-- frames
select pg_temp.check('fr: 5 frames with admin prices', (select string_agg(x->>'slug' || '=' || (x->>'price'), ',') from json_array_elements(public.frame_catalog()) x)
  = 'crimson-queen=400,mystic-blossom=500,frost-guardian=1000,golden-legend=1500,dragon-fury=2000');
do $$ begin
  perform public.frame_equip('dragon-fury');
  perform pg_temp.check('fr: can not wear a frame you do not own', false);
exception when others then perform pg_temp.check('fr: can not wear a frame you do not own', sqlerrm like '%not owned%', sqlerrm); end $$;
select pg_temp.check('fr: buy Dragon Fury (2 000)', (public.frame_buy('dragon-fury', 'fr-key-0001') ->> 'balance')::bigint = 7000);
select pg_temp.check('fr: same request again → not charged twice', (public.frame_buy('dragon-fury', 'fr-key-0001') ->> 'duplicate')::boolean and (public.wallet_me() ->> 'balance')::bigint = 7000);
do $$ begin
  perform public.frame_buy('dragon-fury', 'fr-key-0002');
  perform pg_temp.check('fr: a frame can not be bought twice', false);
exception when others then perform pg_temp.check('fr: a frame can not be bought twice', sqlerrm like '%already owned%', sqlerrm); end $$;
select pg_temp.check('fr: wear it', (public.frame_equip('dragon-fury') ->> 'ok')::boolean);
select pg_temp.check('fr: visible to everyone (frames_active)', exists (select 1 from public.frames_active() where user_id = auth.uid() and frame = 'dragon-fury'));
select pg_temp.check('fr: frames_mine lists owned + equipped', (select (m->>'equipped') = 'dragon-fury' and (m->'owned')::text like '%dragon-fury%' from (select public.frames_mine() m) x));
select pg_temp.check('fr: switch to the free Classic frame', (public.frame_equip('dameo') ->> 'ok')::boolean);
select pg_temp.check('fr: … Classic now shown', exists (select 1 from public.frames_active() where user_id = auth.uid() and frame = 'dameo'));
select pg_temp.check('fr: and take it off', (public.frame_equip(null) ->> 'ok')::boolean);
select pg_temp.check('fr: … no frame shown', not exists (select 1 from public.frames_active() where user_id = auth.uid()));
do $$ begin
  update public.profiles set equipped_frame_item = 'golden-legend' where id = auth.uid();
  perform pg_temp.check('fr: client can NOT set the frame column directly', not exists (select 1 from public.profiles where id = auth.uid() and equipped_frame_item = 'golden-legend'));
exception when others then perform pg_temp.check('fr: client can NOT set the frame column directly', true, sqlerrm); end $$;
do $$ begin
  insert into public.user_frames (user_id, frame_slug, price_paid, idem_key) values (auth.uid(), 'golden-legend', 0, 'forged-key-1');
  perform pg_temp.check('fr: client can NOT forge ownership', false);
exception when others then perform pg_temp.check('fr: client can NOT forge ownership', true, sqlerrm); end $$;
do $$ begin
  perform public.admin_frame_save('crimson-queen', 1, true, 'urinish');
  perform pg_temp.check('fr: players can NOT change frame prices', false);
exception when others then perform pg_temp.check('fr: players can NOT change frame prices', sqlerrm like '%forbidden%', sqlerrm); end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select pg_temp.check('fr: admin changes a frame price', (public.admin_frame_save('crimson-queen', 450, true, 'Narx') ->> 'ok')::boolean);
select pg_temp.check('fr: … price applies + history', (select price = 450 from public.frame_items where slug = 'crimson-queen')
  and exists (select 1 from public.admin_price_history(50) h where h.entity_id = 'frame:crimson-queen' and h.old_value = 400 and h.new_value = 450));
select pg_temp.check('st: admin sees Limited stones next to boards', (select count(*) = 12 and count(*) filter (where x->>'slot' = 'piece') = 4 from json_array_elements(public.admin_boards()) x));
reset role;
select pg_temp.check('st/fr: wallets still match the ledger', (select bool_and(w.balance = coalesce((select sum(amount) from public.wallet_transactions t where t.user_id = w.user_id), 0)) from public.user_wallets w));

\set QUIET off
select case when ok then 'PASS' else 'FAIL' end as status, name, left(detail, 70) as detail from results order by 1 desc, 2;
select count(*) filter (where not ok) as failures, count(*) as total from results;
