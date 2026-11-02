-- 0014: trigger-only functions are not API endpoints. Postgres refuses to run them outside a trigger anyway,
-- but revoking EXECUTE keeps them out of the public RPC surface (Supabase advisor 0028/0029). Triggers keep working:
-- trigger functions run with the table owner's rights, not the caller's EXECUTE grant.
revoke execute on function public._guard_banned_entry() from public, anon, authenticated;
revoke execute on function public._guard_banned_match() from public, anon, authenticated;
revoke execute on function public._guard_banned_queue() from public, anon, authenticated;
revoke execute on function public._wallet_create() from public, anon, authenticated;
