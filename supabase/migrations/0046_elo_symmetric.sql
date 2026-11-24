-- 0046 — Rating = Elo (K = 40), the same number for both players.
--  Before: winner +10…+30 and loser −10…−30, drawn separately at random (one could get +20 while the other lost −10),
--  and the opponent's rating did not matter.
--  Now one number d for the game: the winner gets +d, the loser −d.
--    equal ratings → ±20; the stronger player wins → small (≈ +10 with 200 points more, +1 when far stronger);
--    the stronger player loses → big (≈ −30 with 200 points more, up to −40); a draw moves the lower-rated up a little.
--  The floor 100 (and the virtual players' 3000 ceiling) keep it zero-sum: nobody gains more than the other loses.
--  Unchanged: games under 12 moves change nothing, 5 rated games per pair per day, fair-play rules (0045).
--  Existing ratings are not touched; only games finished from now on.
create or replace function public._elo_delta(p_score numeric, p_me int, p_opp int) returns int
language sql immutable set search_path = public as $$
  select case
    when p_score = 1 then greatest(1, round(40 * (1 - e))::int)
    when p_score = 0 then least(-1, round(-40 * e)::int)
    else greatest(-10, least(10, round(40 * (0.5 - e))::int)) end
  from (select 1 / (1 + power(10::numeric, (coalesce(p_opp, 1200) - p_me) / 400.0)) as e) x
$$;
revoke all on function public._elo_delta(numeric, int, int) from public, anon, authenticated;

create or replace function public.apply_match_result(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype; w public.profiles%rowtype; b public.profiles%rowtype; v public.virtual_players%rowtype;
  ws numeric; wd int; bd int; vd int; d int; opp int; note text; pair_games int; src text;
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
     where x.id <> m.id and x.rating_applied and coalesce(x.rating_note, 'short') = 'short' and x.ended_at > now() - interval '24 hours'
       and ((x.white_id = m.white_id and x.black_id = m.black_id) or (x.white_id = m.black_id and x.black_id = m.white_id));
    if pair_games >= 5 then note := 'pair-limit'; end if;
  end if;

  if note = 'pair-limit' then
    update public.matches set rating_applied = true, white_delta = 0, black_delta = 0, rating_note = note where id = m.id;
    return;
  end if;

  -- Elo (K = 40), one number for both sides: White gets d, Black (or the virtual player) gets −d
  d := public._elo_delta(ws, w.rating, coalesce(b.rating, v.rating));
  -- ended before 12 moves: nobody's rating changes (0045)
  if coalesce(m.move_count, 0) < 12 then
    note := 'short';
    d := 0;
  end if;
  -- the floor (100) and the virtual players' ceiling (3000) keep it zero-sum: nobody gains more than the other loses
  opp := coalesce(b.rating, v.rating);
  if d < 0 then
    d := greatest(d, least(0, 100 - w.rating));                                -- White can't drop below 100
    if v.id is not null then d := greatest(d, least(0, opp - 3000)); end if;   -- virtual can't rise above 3000
  elsif d > 0 then
    d := least(d, greatest(0, opp - 100));                                     -- Black / virtual can't drop below 100
  end if;
  wd := d;
  update public.profiles
     set rating = rating + wd, rated_games = rated_games + 1, last_delta = wd,
         wins = wins + (m.result = 'white')::int, losses = losses + (m.result = 'black')::int, draws = draws + (m.result = 'draw')::int,
         current_streak = case when m.result = 'white' then current_streak + 1 else 0 end,
         best_streak = greatest(best_streak, case when m.result = 'white' then current_streak + 1 else 0 end)
   where id = w.id;
  insert into public.rating_history (user_id, match_id, rating, source, delta) values (w.id, m.id, w.rating + wd, src, wd);

  if m.virtual_id is not null then
    bd := -d;
    update public.virtual_players set rating = rating + bd where id = v.id;
  else
    bd := -d;
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
