-- DAMEO 0004: profile photos, avatar validation, anti-farming for bot games.

/* Avatars: either a colour seed "hue:n", a photo in our own storage bucket, or a Telegram userpic. */
alter table public.profiles add constraint avatar_format check (
  avatar ~ '^[0-9]{1,3}:[0-9]{1,10}$'
  or avatar ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,64}(\?v=[0-9]{1,15})?$'
  or avatar ~ '^https://t\.me/i/userpic/[0-9]{1,4}/[A-Za-z0-9_.=-]{1,200}$'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 512000, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 512000, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

-- photos are public; each player may only write inside their own folder: avatars/<user id>/...
create policy avatars_read on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

/* Bot games: at most 5 RATED bot games per day (Tashkent time); later ones are unrated.
   Leaving a bot game you already moved in counts as a resignation (no escaping a losing game). */
create or replace function public.bot_games_left() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, 5 - count(*))::int from public.matches
   where white_id = auth.uid() and vs_bot and rated
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent');
$$;

create or replace function public.start_bot_match(p_level text default 'random') returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); lvl text := p_level; r float; m public.matches; prev record; left_today int; is_rated boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if lvl is null or lvl not in ('easy','medium','hard') then
    r := random();
    lvl := case when r < 0.4 then 'easy' when r < 0.8 then 'medium' else 'hard' end;
  end if;
  for prev in select id, move_count from public.matches where white_id = uid and vs_bot and status = 'active' for update loop
    if prev.move_count > 0 then
      update public.matches set status = 'finished', result = 'black', result_reason = 'resign', ended_at = now() where id = prev.id;
      perform public.apply_match_result(prev.id);
    else
      update public.matches set status = 'aborted', ended_at = now() where id = prev.id;
    end if;
  end loop;
  left_today := public.bot_games_left();
  is_rated := left_today > 0;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, started_at)
  values (uid, 'active', is_rated, true, lvl, now()) returning * into m;
  return json_build_object('match_id', m.id, 'level', lvl, 'rated', is_rated, 'rated_left', greatest(0, left_today - is_rated::int));
end $$;

revoke execute on function public.bot_games_left() from public, anon;
grant execute on function public.bot_games_left() to authenticated;
