-- DAMEO 0040: referral links that go through the bot (t.me/<bot>?start=ref_<CODE>).
-- The bot's /start remembers "this Telegram user came with code X"; when that user signs into the Mini App
-- (telegram-auth) without a start_param, the remembered code is used — referral_attach still decides everything
-- (new player only, no self-referral, one inviter, daily cap). Codes older than 48 h are ignored. Additive.
create table if not exists public.referral_pending (
  tg_id      bigint primary key,
  code       text not null,
  created_at timestamptz not null default now()
);
alter table public.referral_pending enable row level security;
revoke all on public.referral_pending from anon, authenticated;
grant select, insert, update, delete on public.referral_pending to service_role;

-- bot: remember the code (only a real code; the first code a person used wins)
create or replace function public.referral_pending_set(p_tg bigint, p_code text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_tg is null or p_code is null or p_code !~ '^[A-Za-z2-9]{8}$' then return 'bad-code'; end if;
  if not exists (select 1 from public.referral_codes where code = upper(p_code)) then return 'bad-code'; end if;
  insert into public.referral_pending (tg_id, code) values (p_tg, upper(p_code))
  on conflict (tg_id) do update set code = excluded.code, created_at = now()
    where public.referral_pending.created_at < now() - interval '48 hours';
  return 'ok';
end $$;

-- sign-in: take (and forget) the remembered code
create or replace function public.referral_pending_take(p_tg bigint) returns text
language sql security definer set search_path = public as $$
  delete from public.referral_pending where tg_id = p_tg and created_at > now() - interval '48 hours' returning code;
$$;

revoke all on function public.referral_pending_set(bigint, text), public.referral_pending_take(bigint) from public, anon, authenticated;
grant execute on function public.referral_pending_set(bigint, text), public.referral_pending_take(bigint) to service_role;
