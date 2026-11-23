-- 0045 — A game that ends before 12 moves changes nobody's rating.
--  Before: under 6 moves the winner gained nothing but the loser still lost −10…−30, so resigning on move 1 again and
--  again was the quickest way to drop a rating on purpose. Now a quick loss costs nothing (and a quick win gives
--  nothing — even when the opponent blundered and resigned early). 12 moves is also the coins / missions threshold.
--  Everything else is unchanged (random ±10…30, draw ±5, pair limit 5 per 24 h, floor 100). Existing ratings untouched.
create or replace function public.apply_match_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype; w public.profiles%rowtype; b public.profiles%rowtype; v public.virtual_players%rowtype;
  ws numeric; wd int; bd int; vd int; note text; pair_games int; src text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'finished' or m.rating_applied or not m.rated then return; end if;
  if m.black_id is null and m.virtual_id is null then return; end if;            -- old practice bot: never rated
  ws := case m.result when 'white' then 1 when 'draw' then 0.5 else 0 end;
  src := case when m.virtual_id is not null then 'virtual' else 'pvp' end;
  select * into w from public.profiles where id = m.white_id for update;
  if m.virtual_id is not null then
    select * into v from public.virtual_players where id = m.virtual_id for update;
  else
    select * into b from public.profiles where id = m.black_id for update;
    -- the same pair: at most 5 rated games per 24 h
    select count(*) into pair_games from public.matches x
     where x.id <> m.id and x.rating_applied and x.rating_note is null and x.ended_at > now() - interval '24 hours'
       and ((x.white_id = m.white_id and x.black_id = m.black_id) or (x.white_id = m.black_id and x.black_id = m.white_id));
    if pair_games >= 5 then note := 'pair-limit'; end if;
  end if;

  if note = 'pair-limit' then
    update public.matches set rating_applied = true, white_delta = 0, black_delta = 0, rating_note = note where id = m.id;
    return;
  end if;

  wd := public._rand_delta(ws, w.rating, coalesce(b.rating, v.rating));
  bd := public._rand_delta(1 - ws, coalesce(b.rating, v.rating), w.rating);
  -- ended before 12 moves: nobody's rating changes (0045; before: < 6 moves, the loser still lost)
  if coalesce(m.move_count, 0) < 12 then
    note := 'short';
    wd := 0;
    bd := 0;
  end if;
  wd := greatest(100, w.rating + wd) - w.rating;

  update public.profiles
     set rating = rating + wd, rated_games = rated_games + 1, last_delta = wd,
         wins = wins + (m.result = 'white')::int, losses = losses + (m.result = 'black')::int, draws = draws + (m.result = 'draw')::int,
         current_streak = case when m.result = 'white' then current_streak + 1 else 0 end,
         best_streak = greatest(best_streak, case when m.result = 'white' then current_streak + 1 else 0 end)
   where id = w.id;
  insert into public.rating_history (user_id, match_id, rating, source, delta) values (w.id, m.id, w.rating + wd, src, wd);

  if m.virtual_id is not null then
    vd := greatest(100, least(3000, v.rating + bd)) - v.rating;
    update public.virtual_players set rating = rating + vd where id = v.id;
    bd := vd;
  else
    bd := greatest(100, b.rating + bd) - b.rating;
    update public.profiles
       set rating = rating + bd, rated_games = rated_games + 1, last_delta = bd,
           wins = wins + (m.result = 'black')::int, losses = losses + (m.result = 'white')::int, draws = draws + (m.result = 'draw')::int,
           current_streak = case when m.result = 'black' then current_streak + 1 else 0 end,
           best_streak = greatest(best_streak, case when m.result = 'black' then current_streak + 1 else 0 end)
     where id = b.id;
    insert into public.rating_history (user_id, match_id, rating, source, delta) values (b.id, m.id, b.rating + bd, src, bd);
  end if;

  update public.matches set rating_applied = true, white_delta = wd, black_delta = bd, rating_note = note where id = m.id;
  perform public._ach_check(w.id, m.id);
  if m.black_id is not null then perform public._ach_check(m.black_id, m.id); end if;
end $$;
