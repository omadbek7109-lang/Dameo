-- DAMEO 0026: DAMEO Coins for finished games — win +20, loss +10, draw 0.
--  * Given by the server only, inside the same transaction that applies the game's result (a trigger on
--    matches.rating_applied false → true), so the client can neither trigger nor fake it.
--  * Exactly once per player per game: the wallet ledger's unique key `match:<id>` (replays return the same balance).
--  * Only real games that count: rated games (player vs player and vs virtual opponents; practice bots are unrated),
--    a winner/loser (no draws), at least 12 moves in total (leaving after ~5 moves each, even on time, gives nothing),
--    not blocked by the same-pair limit. Virtual opponents get no coins.
--  * Every credit is a wallet_transactions row (kind 'reward', ref_type 'match', ref_id = match id, note win|loss).
-- Additive: new function + trigger; the rating code is not changed.

create or replace function public._match_coin_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare win_uid uuid; lose_uid uuid;
begin
  if new.status <> 'finished' or not new.rated or new.result not in ('white', 'black') then return new; end if;
  if coalesce(new.move_count, 0) < 12 or new.rating_note is not null then return new; end if;   -- short / pair-limit
  if new.black_id is null and new.virtual_id is null then return new; end if;                   -- practice bot
  win_uid := case new.result when 'white' then new.white_id else new.black_id end;              -- null = virtual opponent
  lose_uid := case new.result when 'white' then new.black_id else new.white_id end;
  begin
    if win_uid is not null then
      perform public._wallet_apply(win_uid, 20, 'reward', 'match', new.id::text, 'match:' || new.id, 'win', null);
    end if;
    if lose_uid is not null then
      perform public._wallet_apply(lose_uid, 10, 'reward', 'match', new.id::text, 'match:' || new.id, 'loss', null);
    end if;
  exception when others then
    raise warning 'match coin reward failed for %: %', new.id, sqlerrm;   -- never block the game result
  end;
  return new;
end $$;
revoke all on function public._match_coin_reward() from public, anon, authenticated;

create or replace trigger matches_coin_reward
  after update of rating_applied on public.matches
  for each row when (new.rating_applied and not old.rating_applied)
  execute function public._match_coin_reward();

-- the caller's coins for one game (for the result window): {coins: 20 | 10 | 0, settled, balance}
-- settled = the server has finished this game's result (coins can no longer change)
create or replace function public.match_coins(p_match uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'coins', coalesce((select t.amount from public.wallet_transactions t where t.user_id = auth.uid() and t.idem_key = 'match:' || p_match), 0),
    'settled', exists (select 1 from public.matches m where m.id = p_match and m.rating_applied and auth.uid() in (m.white_id, m.black_id)),
    'balance', coalesce((select w.balance from public.user_wallets w where w.user_id = auth.uid()), 0));
$$;
revoke all on function public.match_coins(uuid) from public, anon;
grant execute on function public.match_coins(uuid) to authenticated;
