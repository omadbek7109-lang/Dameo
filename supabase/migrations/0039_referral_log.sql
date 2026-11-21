-- DAMEO 0039: a small log of referral link attempts (to see why an invite did not count).
-- telegram-auth writes one row when a player signs in for the first time, or opens the app with a ref link:
-- the start_param Telegram gave (if any) and what referral_attach answered (ok / not-new / already / self / bad-code …).
-- Read-only diagnostics: nothing here changes coins or referrals. Additive.
create table if not exists public.referral_log (
  id          bigint generated always as identity primary key,
  tg_id       bigint,
  user_id     uuid,
  new_account boolean not null default false,
  start_param text,
  result      text,
  at          timestamptz not null default now()
);
create index if not exists referral_log_at on public.referral_log (at desc);
alter table public.referral_log enable row level security;
revoke all on public.referral_log from anon, authenticated;
grant select, insert on public.referral_log to service_role;
