-- DAMEO 0029: the inviter's instant +20 ("friend joined") is paid for at most 10 new friends per day (Asia/Tashkent).
--  * Friends beyond that are still linked; their +30 after 2 real games is paid as before.
--  * The inviter's row in referral_codes is locked while counting, so parallel joins cannot exceed the limit.
-- Additive: function replaced only.

create or replace function public.referral_attach(p_invitee uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare inv uuid; me public.profiles; them public.profiles; rid bigint; today int;
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
  -- the inviter's +20 for a new friend: at most 10 a day (Tashkent), counted under a lock on the inviter
  perform 1 from public.referral_codes where user_id = inv for update;
  select count(*) into today from public.referrals
   where inviter_id = inv and join_reward > 0
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent');
  if today < 10 then
    perform public._wallet_apply(inv, 20, 'reward', 'referral', rid::text, 'referral:join:' || rid, 'join', null);
    update public.referrals set join_reward = 20 where id = rid;
  end if;
  return 'ok';
end $$;
