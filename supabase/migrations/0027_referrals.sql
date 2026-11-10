-- DAMEO 0027: Referral system (Telegram Mini App deep link only: https://t.me/<bot>?startapp=ref_<CODE>).
--  * Every player gets a unique 8-character code (made on first use).
--  * The code is read ONLY from Telegram's signed launch data: the `telegram-auth` Edge Function checks the initData
--    signature, takes start_param and calls referral_attach() with the service role. A plain web URL cannot create one.
--  * Only a NEW player can be referred: account at most 48 h old, no finished game yet, not referred before. No self-
--    referral (same account or same Telegram id). One player = one inviter, for ever (unique invitee_id).
--  * The invited player must finish 2 REAL games: rated, at least 12 moves, ended on the board or by the chess clock
--    (not a resignation, not "stopped moving"), not over the same-pair limit, not against the inviter, not a practice bot.
--    Each game is counted once (referral_games primary key). After the 2nd one, in the same transaction that applies the
--    game's result: invited player +30, inviter +20 DAMEO Coins — each exactly once (referral_rewards unique per role +
--    wallet idempotency keys), under a row lock on the referral, so parallel game ends cannot pay twice.
--  * Tables have RLS on and no client grants; players read their own data through referral_overview() only.
-- Additive: new tables, functions and one trigger on matches; existing behaviour is unchanged.

create table if not exists public.referral_codes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id           bigint generated always as identity primary key,
  inviter_id   uuid not null references public.profiles(id) on delete cascade,
  invitee_id   uuid not null unique references public.profiles(id) on delete cascade,
  code         text not null,
  status       text not null default 'pending' check (status in ('pending', 'rewarded')),
  games        int not null default 0 check (games >= 0),
  created_at   timestamptz not null default now(),
  rewarded_at  timestamptz,
  check (inviter_id <> invitee_id)
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_id, created_at desc);

create table if not exists public.referral_games (
  referral_id bigint not null references public.referrals(id) on delete cascade,
  match_id    uuid not null references public.matches(id) on delete cascade,
  counted_at  timestamptz not null default now(),
  primary key (referral_id, match_id)
);

create table if not exists public.referral_rewards (
  id          bigint generated always as identity primary key,
  referral_id bigint not null references public.referrals(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('inviter', 'invitee')),
  amount      int not null check (amount > 0),
  created_at  timestamptz not null default now(),
  unique (referral_id, role)
);
create index if not exists referral_rewards_user_idx on public.referral_rewards (user_id);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_games enable row level security;
alter table public.referral_rewards enable row level security;
revoke all on public.referral_codes, public.referrals, public.referral_games, public.referral_rewards from anon, authenticated;
grant select, insert, update on public.referral_codes, public.referrals, public.referral_games, public.referral_rewards to service_role;

/* ---------------------------------------------------------------- codes */
-- the player's code, created on first use (no 0/O/1/I to avoid typos)
create or replace function public._referral_code_for(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text; abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select code into c from public.referral_codes where user_id = p_user;
  if found then return c; end if;
  for i in 1 .. 20 loop
    c := (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 8));
    begin
      insert into public.referral_codes (user_id, code) values (p_user, c);
      return c;
    exception when unique_violation then
      select code into c from public.referral_codes where user_id = p_user;   -- a parallel call made it first
      if found then return c; end if;
    end;
  end loop;
  raise exception 'could not make a referral code';
end $$;

/* ---------------------------------------------------------------- linking (service role, from telegram-auth) */
-- p_code: the start_param after "ref_". Returns ok | bad-code | self | already | not-new | restricted
create or replace function public.referral_attach(p_invitee uuid, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare inv uuid; me public.profiles; them public.profiles; n int;
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
  on conflict (invitee_id) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'already' end;
end $$;

/* ---------------------------------------------------------------- counting games + rewards (trigger on matches) */
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
        insert into public.referral_rewards (referral_id, user_id, role, amount) values (r.id, r.invitee_id, 'invitee', 30) on conflict do nothing;
        get diagnostics n = row_count;
        if n = 1 then perform public._wallet_apply(r.invitee_id, 30, 'reward', 'referral', r.id::text, 'referral:invitee:' || r.id, 'invitee', null); end if;
        insert into public.referral_rewards (referral_id, user_id, role, amount) values (r.id, r.inviter_id, 'inviter', 20) on conflict do nothing;
        get diagnostics n = row_count;
        if n = 1 then perform public._wallet_apply(r.inviter_id, 20, 'reward', 'referral', r.id::text, 'referral:inviter:' || r.id, 'inviter', null); end if;
        update public.referrals set status = 'rewarded', rewarded_at = now() where id = r.id;
      end if;
    exception when others then
      raise warning 'referral progress failed for match % player %: %', new.id, p, sqlerrm;
    end;
  end loop;
  return new;
end $$;
revoke all on function public._referral_progress() from public, anon, authenticated;

create or replace trigger matches_referral_progress
  after update of rating_applied on public.matches
  for each row when (new.rating_applied and not old.rating_applied)
  execute function public._referral_progress();

/* ---------------------------------------------------------------- the Referral page */
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
    'earned', (select coalesce(sum(amount), 0) from public.referral_rewards where user_id = uid),
    'pending_coins', (select coalesce(sum(20), 0) from public.referrals where inviter_id = uid and status = 'pending')
                     + coalesce((select 30 from public.referrals where invitee_id = uid and status = 'pending'), 0),
    'reward_inviter', 20, 'reward_invitee', 30, 'games_needed', 2,
    'friends', coalesce((select json_agg(x order by x.created_at desc) from (
        select pr.username, pr.avatar, r.status, least(r.games, 2) as games, r.created_at, r.rewarded_at
          from public.referrals r join public.profiles pr on pr.id = r.invitee_id
         where r.inviter_id = uid order by r.created_at desc limit 100) x), '[]'::json),
    'invited_by', (select json_build_object('username', pr.username, 'avatar', pr.avatar, 'status', r.status, 'games', least(r.games, 2), 'rewarded_at', r.rewarded_at)
                     from public.referrals r join public.profiles pr on pr.id = r.inviter_id where r.invitee_id = uid));
end $$;

revoke all on function public._referral_code_for(uuid), public.referral_attach(uuid, text), public.referral_overview() from public, anon, authenticated;
grant execute on function public.referral_overview() to authenticated;
grant execute on function public.referral_attach(uuid, text) to service_role;
