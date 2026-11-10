-- DAMEO 0028: referral rewards, new amounts.
--  * Inviter: +20 DAMEO Coins as soon as a NEW player joins through the link (paid inside referral_attach, in the same
--    transaction that creates the referral; one referral per invited player, so it is paid once), and +30 more when
--    that player has finished 2 real games  →  up to 50 coins per friend.
--  * Invited player: +20 after the 2 real games (not advertised in the app).
--  * Same rules as 0027 for who counts and which games count; each payment has its own wallet idempotency key.
-- Additive: one new column; functions replaced. No data changes (there were no referrals yet).

alter table public.referrals add column if not exists join_reward int not null default 0 check (join_reward >= 0);

create or replace function public.referral_attach(p_invitee uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare inv uuid; me public.profiles; them public.profiles; rid bigint;
begin
  if p_invitee is null or p_code is null or p_code !~ '^[A-Za-z2-9]{8}$' then return 'bad-code'; end if;
  select user_id into inv from public.referral_codes where code = upper(p_code);
  if not found then return 'bad-code'; end if;
  if inv = p_invitee then return 'self'; end if;
  select * into me from public.profiles where id = p_invitee for update;          -- serialises parallel attaches
  if not found then return 'bad-code'; end if;
  if exists (select 1 from public.referrals where invitee_id = p_invitee) then return 'already'; end if;
  select * into them from public.profiles where id = inv;
  if them.tg_id is not null and them.tg_id = me.tg_id then return 'self'; end if;
  if public._is_banned(inv) or public._is_banned(p_invitee) then return 'restricted'; end if;
  if me.created_at < now() - interval '48 hours'
     or exists (select 1 from public.matches m where m.status = 'finished' and p_invitee in (m.white_id, m.black_id)) then
    return 'not-new';
  end if;
  insert into public.referrals (inviter_id, invitee_id, code) values (inv, p_invitee, upper(p_code))
  on conflict (invitee_id) do nothing
  returning id into rid;
  if rid is null then return 'already'; end if;
  -- the inviter's +20 for the new player joining (same transaction: no referral without its reward, never twice)
  perform public._wallet_apply(inv, 20, 'reward', 'referral', rid::text, 'referral:join:' || rid, 'join', null);
  update public.referrals set join_reward = 20 where id = rid;
  return 'ok';
end $$;

create or replace function public._referral_progress() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid; opp uuid; r public.referrals; n int;
begin
  -- a real game: rated, ≥ 12 moves, a result on the board or by the chess clock; not resigned, not abandoned
  if new.status <> 'finished' or not new.rated or new.result is null or new.rating_note is not null
     or coalesce(new.move_count, 0) < 12 or (new.black_id is null and new.virtual_id is null) then return new; end if;
  if new.result_reason = 'resign' and new.timeout_kind is distinct from 'clock' then return new; end if;
  foreach p in array array[new.white_id, new.black_id] loop
    continue when p is null;
    opp := case when p = new.white_id then new.black_id else new.white_id end;
    begin                                                       -- own sub-transaction: all or nothing, never blocks the game
      select * into r from public.referrals where invitee_id = p and status = 'pending' for update;
      continue when not found;
      continue when opp is not null and opp = r.inviter_id;    -- games against the inviter do not count
      insert into public.referral_games (referral_id, match_id) values (r.id, new.id) on conflict do nothing;
      get diagnostics n = row_count;
      continue when n = 0;                                      -- this game was already counted
      update public.referrals set games = games + 1 where id = r.id returning * into r;
      if r.games >= 2 then
        insert into public.referral_rewards (referral_id, user_id, role, amount) values (r.id, r.invitee_id, 'invitee', 20) on conflict do nothing;
        get diagnostics n = row_count;
        if n = 1 then perform public._wallet_apply(r.invitee_id, 20, 'reward', 'referral', r.id::text, 'referral:invitee:' || r.id, 'invitee', null); end if;
        insert into public.referral_rewards (referral_id, user_id, role, amount) values (r.id, r.inviter_id, 'inviter', 30) on conflict do nothing;
        get diagnostics n = row_count;
        if n = 1 then perform public._wallet_apply(r.inviter_id, 30, 'reward', 'referral', r.id::text, 'referral:inviter:' || r.id, 'inviter', null); end if;
        update public.referrals set status = 'rewarded', rewarded_at = now() where id = r.id;
      end if;
    exception when others then
      raise warning 'referral progress failed for match % player %: %', new.id, p, sqlerrm;
    end;
  end loop;
  return new;
end $$;

-- the Referral page: only the inviter's side (the invited player's bonus is not shown)
create or replace function public.referral_overview() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  c := public._referral_code_for(uid);
  return json_build_object(
    'code', c,
    'invited', (select count(*) from public.referrals where inviter_id = uid),
    'successful', (select count(*) from public.referrals where inviter_id = uid and status = 'rewarded'),
    'pending', (select count(*) from public.referrals where inviter_id = uid and status = 'pending'),
    'earned', (select coalesce(sum(join_reward), 0) from public.referrals where inviter_id = uid)
              + (select coalesce(sum(amount), 0) from public.referral_rewards where user_id = uid and role = 'inviter'),
    'pending_coins', (select count(*) * 30 from public.referrals where inviter_id = uid and status = 'pending'),
    'reward_join', 20, 'reward_games', 30, 'games_needed', 2,
    'friends', coalesce((select json_agg(x order by x.created_at desc) from (
        select pr.username, pr.avatar, r.status, least(r.games, 2) as games, r.created_at, r.rewarded_at,
               r.join_reward + coalesce((select sum(amount) from public.referral_rewards w where w.referral_id = r.id and w.role = 'inviter'), 0) as earned
          from public.referrals r join public.profiles pr on pr.id = r.invitee_id
         where r.inviter_id = uid order by r.created_at desc limit 100) x), '[]'::json));
end $$;
