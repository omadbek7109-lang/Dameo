-- 0047 — Server load: profiles leaves the postgres_changes publication.
-- The app uses the broadcast path (0035, rt_settings.mode = 'broadcast'), which announces real profile changes itself.
-- With profiles in the publication, Realtime decoded every presence heartbeat (last_seen, once a minute per player)
-- for the few clients still on the old path — the heaviest single DB job. Idempotent; re-add with
-- `alter publication supabase_realtime add table public.profiles` if ever needed.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    execute 'alter publication supabase_realtime drop table public.profiles';
  end if;
end $$;
