-- DAMEO 0009: games against the bot never change the rating (they are practice).
-- Same function signature as 0004; only the rated flag changes. Player-vs-player rating (±5) is untouched.
-- apply_match_result already skips unrated games, so no rating, rating history or W/L stats come from bot games.
create or replace function public.start_bot_match(p_level text default 'random') returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); lvl text := p_level; r float; m public.matches; prev record;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if lvl is null or lvl not in ('easy','medium','hard') then
    r := random();
    lvl := case when r < 0.4 then 'easy' when r < 0.8 then 'medium' else 'hard' end;
  end if;
  -- one live bot game per player: a started one is closed as a resignation, an untouched one is aborted
  for prev in select id, move_count from public.matches where white_id = uid and vs_bot and status = 'active' for update loop
    if prev.move_count > 0 then
      update public.matches set status = 'finished', result = 'black', result_reason = 'resign', ended_at = now() where id = prev.id;
    else
      update public.matches set status = 'aborted', ended_at = now() where id = prev.id;
    end if;
  end loop;
  insert into public.matches (white_id, status, rated, vs_bot, bot_level, started_at)
  values (uid, 'active', false, true, lvl, now()) returning * into m;
  return json_build_object('match_id', m.id, 'level', lvl, 'rated', false, 'rated_left', 0);
end $$;

-- bot games still in progress become unrated too
update public.matches set rated = false where vs_bot and status = 'active' and rated;
