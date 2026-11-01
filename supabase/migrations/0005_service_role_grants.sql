-- DAMEO 0005 — FIX for "Server yurishni qabul qilmadi".
-- Newer Supabase projects do NOT grant table privileges to service_role automatically.
-- Edge Functions (match-action, telegram-auth) run as service_role, so without these grants every
-- move request failed with "permission denied for table matches" and the function answered 404.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.apply_match_result(uuid) to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- Clients never need these (TRUNCATE ignores RLS).
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Backfill tg_id for Telegram players created while the grant was missing.
update public.profiles p set tg_id = (u.raw_user_meta_data->>'tg_id')::bigint
  from auth.users u
 where u.id = p.id and p.tg_id is null and (u.raw_user_meta_data->>'tg_id') ~ '^[0-9]+$';
